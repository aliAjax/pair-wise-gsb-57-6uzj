import { createInitialState } from '../src/services/mockData'
import type { DataSystem } from '../src/lib/schemas'
import {
  migrateState,
  publishInventoryVersion,
  retryBatch,
  submitInventoryChange,
  getEffectiveVersion,
} from '../src/services/reconciliation'

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  if (!condition) {
    failures += 1
    console.error(`❌ ${name} ${detail}`)
  } else {
    console.log(`✅ ${name} ${detail}`)
  }
}

// ---- 1. 旧数据回填：模拟 localStorage 中没有版本字段的旧工作区 ----
const fresh = createInitialState()
const legacy = {
  requests: fresh.requests.map((r) => ({
    ...r,
    inventoryVersionId: undefined,
    reconciledVersionId: undefined,
    tasks: r.tasks.map((t) => ({ ...t, generatedByVersionId: undefined })),
  })),
  systems: fresh.systems,
  comments: fresh.comments,
  audit: [],
  revision: 1,
} as any
const migrated = migrateState(legacy as any)
check('旧数据回填生成 v1 有效版本', getEffectiveVersion(migrated)?.id === 'inv-v1')
check(
  '旧请求统一挂靠 v1',
  migrated.requests.every((r: any) => r.inventoryVersionId === 'inv-v1' && r.reconciledVersionId === 'inv-v1'),
)
check('回填幂等', migrateState(migrated) === migrated)

// ---- 2. 两个管理员同时基于 v1 提交同一变更：只放行一位 ----
let state = createInitialState()
const nextSystems = state.systems.map((s) =>
  s.id === 'sys-order'
    ? { ...s, requestTypes: [...new Set([...s.requestTypes, 'rectification'])] as DataSystem['requestTypes'] }
    : s,
)
const first = submitInventoryChange(state, {
  baseVersionId: 'inv-v1',
  changeSummary: '订单平台支持更正',
  systems: nextSystems,
  operator: '管理员甲',
})
check('第一位提交进入待生效', first.outcome === 'pending' && !!first.versionId)
state = first.state

const second = submitInventoryChange(state, {
  baseVersionId: 'inv-v1',
  changeSummary: '订单平台支持更正（乙的版本）',
  systems: nextSystems,
  operator: '管理员乙',
})
check('后到者保留为冲突草稿', second.outcome === 'draft' && !!second.versionId)
state = second.state
const draftVersion = state.inventoryVersions.find((v) => v.id === second.versionId)
check('草稿记录抢先版本差异引用', draftVersion?.conflictWithVersionId === first.versionId)
check('待生效仍然只有甲的版本', state.inventoryVersions.filter((v) => v.status === 'pending').length === 1)

// 同一管理员再次提交 → 修订而非新建
const amend = submitInventoryChange(state, {
  baseVersionId: 'inv-v1',
  changeSummary: '订单平台支持更正（修订）',
  systems: nextSystems,
  operator: '管理员甲',
})
check('同一管理员重复提交修订待生效版本', amend.outcome === 'amended')
state = amend.state
check('修订不新增待生效版本', state.inventoryVersions.filter((v) => v.status === 'pending').length === 1)

// ---- 3. 发布到一半失败：检查点保留 ----
const pendingId = state.inventoryVersions.find((v) => v.status === 'pending')!.id
const publish = publishInventoryVersion(state, pendingId, '管理员甲', true)
check('模拟失败返回 failed', publish.outcome === 'failed')
state = publish.state
let batch = state.reconciliationBatches.find((b) => b.versionId === pendingId)!
check('失败批次保留检查点', batch.status === 'failed' && batch.nextIndex > 0 && batch.nextIndex < batch.items.length)
check('失败后有效版本仍是 v1', getEffectiveVersion(state)?.id === 'inv-v1')
check('失败后 systems 未切换', state.systems.some((s) => s.id === 'sys-order' && !s.requestTypes.includes('rectification')))

const req003 = state.requests.find((r) => r.id === 'req-003')!
const req003TasksBeforePublish = req003.tasks.length
const req001 = state.requests.find((r) => r.id === 'req-001')!
const req001TasksBeforePublish = req001.tasks.length

// ---- 4. 续跑：只补未完成项，幂等不重复 ----
const retry1 = retryBatch(state, batch.id, '管理员甲', true)
// 若还有剩余项，再次模拟失败不应重复已完成项
state = retry1.state
batch = state.reconciliationBatches.find((b) => b.id === batch.id)!
if (batch.status === 'failed') {
  check('二次中断后已完成 item 保持 done', batch.items.slice(0, batch.nextIndex).every((i) => i.status !== 'pending'))
  const retry2 = retryBatch(state, batch.id, '管理员甲', false)
  state = retry2.state
} else {
  // 一次续跑就完成（只有 1 个未完成项时）
  check('续跑完成批次', retry1.outcome === 'completed')
}
batch = state.reconciliationBatches.find((b) => b.id === batch.id)!
check('批次最终完成', batch.status === 'completed' && batch.nextIndex === batch.items.length)

// 最终态校验补生成（req-003 可能在首次失败时未处理、由续跑补齐）
const req003Final = state.requests.find((r) => r.id === 'req-003')!
const orderLocate = req003Final.tasks.find((t) => t.id === 'req-003-locate-sys-order')
check('在途请求补生成缺失任务（订单支持更正后）', !!orderLocate)
check('补生成任务带版本戳', orderLocate?.generatedByVersionId === pendingId)
check('补生成恰好 2 项（定位+执行）', req003Final.tasks.length === req003TasksBeforePublish + 2)

// 审计幂等：重新续跑已完成批次不产生审计，也不重复任务
const auditAfterDone = state.audit.length
const tasksAfterDone = req003Final.tasks.length
const req001TasksAfterDone = state.requests.find((r) => r.id === 'req-001')!.tasks.length
const retryCompleted = retryBatch(state, batch.id, '管理员甲', false)
state = retryCompleted.state
check('已完成批次重复重试为 no-op（审计不重复）', state.audit.length === auditAfterDone)
const req003AfterRetry = state.requests.find((r) => r.id === 'req-003')!
check('已完成批次重复重试不重复生成任务', req003AfterRetry.tasks.length === tasksAfterDone)
check('其他请求任务不受重试影响', state.requests.find((r) => r.id === 'req-001')!.tasks.length === req001TasksAfterDone && req001TasksAfterDone === req001TasksBeforePublish)

// ---- 5. 发布完成后有效版本切换，全工作区认同 ----
const effective = getEffectiveVersion(state)!
check('有效版本切换为新版本', effective.id === pendingId)
check('systems 切换为新版清单', state.systems.find((s) => s.id === 'sys-order')?.requestTypes.includes('rectification'))
check('旧 v1 被标记 superseded', state.inventoryVersions.find((v) => v.id === 'inv-v1')?.status === 'superseded')

// ---- 6. 已完成请求：冻结原始回执但不重算任务 ----
const req005 = state.requests.find((r) => r.id === 'req-005')!
const req005TaskCount = req005.tasks.length
const item005 = batch.items.find((i) => i.requestId === 'req-005')
// req-005 受 sys-crm/sys-marketing 变更影响与否取决于 diff；本发布只改 sys-order，故 req005 不在批次
check('未受影响的已完成请求不在批次中', !item005)

// 退役营销平台的发布：req-005（已完成）应被冻结证据但跳过任务
let state2 = createInitialState()
const retireSystems = state2.systems.map((s) => (s.id === 'sys-marketing' ? { ...s, status: 'retired' as const } : s))
const sub2 = submitInventoryChange(state2, {
  baseVersionId: 'inv-v1',
  changeSummary: '营销平台退役',
  systems: retireSystems,
  operator: '管理员甲',
})
state2 = sub2.state
const pub2 = publishInventoryVersion(state2, sub2.versionId!, '管理员甲', false)
check('退役发布完成', pub2.outcome === 'completed')
state2 = pub2.state
const req005b = state2.requests.find((r) => r.id === 'req-005')!
check('已完成请求任务数量不变', req005b.tasks.length === req005TaskCount)
check('已完成请求全部任务仍 completed', req005b.tasks.every((t) => t.status === 'completed'))
check('已完成请求原始回执仍可查（证据保留）', req005b.evidence.length === 1 && !!req005b.evidence[0].frozenAt)
const batch2 = state2.reconciliationBatches.find((b) => b.versionId === sub2.versionId)!
const item005b = batch2.items.find((i) => i.requestId === 'req-005')
check('已完成请求在批次中标记 skipped', item005b?.status === 'skipped')

// 在途 req-001 的营销? req-001 不含 marketing；req-002 含 marketing 且未完成 → 任务应被阻断
const req002b = state2.requests.find((r) => r.id === 'req-002')!
const blockedMarketingTasks = req002b.tasks.filter(
  (t) => t.systemId === 'sys-marketing' && t.status === 'blocked',
)
check('退役系统的在途未完成任务转阻断', blockedMarketingTasks.length === 2)

// ---- 7. 迁移后的旧数据参与重算（在迁移结果上提交+发布） ----
const sub3 = submitInventoryChange(migrated, {
  baseVersionId: 'inv-v1',
  changeSummary: '在回填工作区上退役营销平台',
  systems: migrated.systems.map((s) => (s.id === 'sys-marketing' ? { ...s, status: 'retired' as const } : s)),
  operator: '管理员甲',
})
check('回填后的旧数据可正常提交重算', sub3.outcome === 'pending')
const pub3 = publishInventoryVersion(sub3.state, sub3.versionId!, '管理员甲', false)
check('回填后的旧数据发布重算成功', pub3.outcome === 'completed')

console.log(failures ? `\n${failures} 项检查失败` : '\n全部检查通过')
process.exit(failures ? 1 : 0)
