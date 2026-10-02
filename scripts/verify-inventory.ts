import { createInitialState } from '@/services/mockData'
import {
  normalizeWorkspace,
  publishInventoryVersion,
  resumePublishBatch,
  saveInventoryDraft,
  submitInventoryDraft,
  effectiveVersion,
  pendingVersion,
} from '@/services/inventoryService'
import type { WorkspaceState } from '@/types/domain'

let failures = 0
function check(name: string, condition: boolean, extra?: unknown) {
  if (condition) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.error(`  ✗ ${name}`, extra ?? '')
  }
}

// ---------- 1. 旧数据回填 ----------
console.log('1. 旧数据回填清单版本')
const legacy = createInitialState() as unknown as Record<string, unknown>
delete legacy.inventory
delete legacy.publishBatches
for (const request of legacy.requests as Array<Record<string, unknown>>) {
  delete request.inventoryVersionId
}
const backfilled = normalizeWorkspace(legacy as unknown as WorkspaceState)
check('回填出 v1 有效版本', backfilled.inventory.activeVersionId === 'inv-v1')
check(
  '全部请求回填版本标记',
  backfilled.requests.every((request) => request.inventoryVersionId === 'inv-v1'),
)

// ---------- 2. 提交进入待生效 + 并发只放行一位 ----------
console.log('2. 提交待生效与并发冲突')
let state = createInitialState()
const changedSystems = state.systems.map((system) =>
  system.id === 'sys-support'
    ? { ...system, status: 'retired' as const }
    : system.id === 'sys-crm'
      ? { ...system, owner: '客户数据平台组' }
      : system,
)
state = saveInventoryDraft(state, changedSystems, '客服系统退役，CRM 团队更名', '管理员A')
check('草稿已保存', state.inventory.drafts.length === 1)
// 管理员B 也基于 v1 保存自己的草稿
const systemsB = state.systems.map((system) =>
  system.id === 'sys-risk' ? { ...system, slaDays: 3 } : system,
)
state = saveInventoryDraft(state, systemsB, '风控 SLA 调整', '管理员B')
state = submitInventoryDraft(state, state.inventory.drafts.find((d) => d.updatedBy === '管理员A')!.id, '管理员A')
const pending = pendingVersion(state)
check('管理员A 提交进入待生效 v2', pending?.version === 2 && pending.createdBy === '管理员A')
check('管理员A 草稿已消费', !state.inventory.drafts.some((d) => d.updatedBy === '管理员A'))
const draftB = state.inventory.drafts.find((d) => d.updatedBy === '管理员B')
check('管理员B 草稿保留且标记冲突', draftB?.status === 'conflicted')
check(
  '管理员B 看到与胜出版本的差异',
  Boolean(draftB?.conflictSummary?.some((line) => line.includes('差异'))),
  draftB?.conflictSummary,
)
// B 再次提交仍不放行（存在待生效版本）
state = submitInventoryDraft(state, draftB!.id, '管理员B')
check('待生效版本仍只有一个', state.inventory.versions.filter((v) => v.status === 'pending').length === 1)
check('管理员B 草稿仍保留', state.inventory.drafts.some((d) => d.updatedBy === '管理员B'))

// ---------- 3. 发布批次中断与检查点 ----------
console.log('3. 发布批次中断保留检查点')
const before = state
state = publishInventoryVersion(state, '管理员A', 2)
const failedBatch = state.publishBatches[0]
check('批次标记为中断', failedBatch.status === 'failed')
check('检查点停在 2', failedBatch.checkpoint === 2, failedBatch.checkpoint)
check('版本仍未生效', state.inventory.activeVersionId === 'inv-v1' && pending?.status === 'pending')
check('已处理项保留（前两个请求已重算）', failedBatch.items.slice(0, 2).every((i) => i.status !== 'pending'))
check('未完成项保持待处理', failedBatch.items.slice(2).every((i) => i.status === 'pending'))
const req1AfterFail = state.requests.find((r) => r.id === 'req-001')!
check('受影响请求证据已冻结', req1AfterFail.evidence.every((e) => e.frozenAt))
check(
  '退役系统的未完成任务已取消',
  !req1AfterFail.tasks.some((t) => t.id.includes('sys-support') && t.status !== 'completed'),
)
check('退役系统冲突进入复核', req1AfterFail.conflicts.some((c) => c.includes('已退役')))
check('中断写入审计', state.audit.some((a) => a.action === '发布批次中断'))
check('重算写入请求审计', req1AfterFail.audit.some((a) => a.action === '清单版本重算'))

// ---------- 4. 重试只补未完成项，不重复任务和审计 ----------
console.log('4. 检查点重试与幂等')
const auditCountBefore = state.audit.length
const req1TasksBefore = req1AfterFail.tasks.map((t) => t.id).sort()
state = resumePublishBatch(state, failedBatch.id, '管理员A')
const doneBatch = state.publishBatches[0]
check('批次完成', doneBatch.status === 'completed')
check('检查点走满', doneBatch.checkpoint === doneBatch.items.length)
check('版本生效', state.inventory.activeVersionId !== 'inv-v1' && effectiveVersion(state).version === 2)
check('系统清单切换为新版本', state.systems.find((s) => s.id === 'sys-support')?.status === 'retired')
const req1 = state.requests.find((r) => r.id === 'req-001')!
check('req-001 任务未重复生成', JSON.stringify(req1.tasks.map((t) => t.id).sort()) === JSON.stringify(req1TasksBefore))
check('全局审计无重复 id', new Set(state.audit.map((a) => a.id)).size === state.audit.length)
check('req-001 重算审计只有一条', req1.audit.filter((a) => a.action === '清单版本重算').length === 1)
check('新增审计仅为续跑部分', state.audit.length > auditCountBefore)
const req5 = state.requests.find((r) => r.id === 'req-005')!
check('已完成请求原始回执保留可查', req5.evidence.length === 1 && req5.evidence[0].name === '删除执行回执')
check('已完成请求任务保持完成', req5.tasks.every((t) => t.status === 'completed'))
check('全部请求对齐有效版本', state.requests.every((r) => r.inventoryVersionId === state.inventory.activeVersionId))
const req4 = state.requests.find((r) => r.id === 'req-004')!
check('不受影响请求标记无需变更', doneBatch.items.find((i) => i.requestId === 'req-004')?.status === 'skipped')
check('已完成任务未被取消（req-004 待关闭）', req4.status === 'pending-close')

// 重复重试被拒绝
let threw = false
try {
  resumePublishBatch(state, doneBatch.id, '管理员A')
} catch {
  threw = true
}
check('已完成批次拒绝重复重试', threw)

// ---------- 5. 完整发布（无中断）----------
console.log('5. 无中断完整发布')
let state2 = createInitialState()
const systems2 = state2.systems.filter((s) => s.id !== 'sys-archive')
state2 = saveInventoryDraft(state2, systems2, '档案库下线', '管理员A')
state2 = submitInventoryDraft(state2, state2.inventory.drafts[0].id, '管理员A')
state2 = publishInventoryVersion(state2, '管理员A')
check('一次发布成功', state2.publishBatches[0].status === 'completed')
check('有效版本推进到 v2', effectiveVersion(state2).version === 2)
check('系统清单移除档案库', !state2.systems.some((s) => s.id === 'sys-archive'))

console.log(failures ? `\n${failures} 项检查失败` : '\n全部检查通过')
process.exit(failures ? 1 : 0)
