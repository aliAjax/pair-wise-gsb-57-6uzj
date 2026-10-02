import type {
  AuditEntry,
  DataSystem,
  InventoryVersion,
  PrivacyRequest,
  ReconciliationBatch,
  ReconciliationItem,
  SystemChange,
  WorkspaceState,
} from '@/types/domain'
import { buildWorkflowSteps } from './workflow'

export const BASELINE_VERSION_ID = 'inv-v1'
const CLOSED_STATUSES: PrivacyRequest['status'][] = ['completed', 'rejected']

const cloneState = (state: WorkspaceState): WorkspaceState => structuredClone(state)
const now = () => new Date().toISOString()

const SYSTEM_FIELDS: { key: keyof DataSystem; label: string }[] = [
  { key: 'name', label: '系统名称' },
  { key: 'owner', label: '责任团队' },
  { key: 'dataDomain', label: '数据域' },
  { key: 'transferMethod', label: '传输方式' },
  { key: 'slaDays', label: '处理时限' },
  { key: 'status', label: '系统状态' },
  { key: 'requestTypes', label: '支持请求类型' },
]

function fieldChanged(left: DataSystem, right: DataSystem, key: keyof DataSystem): boolean {
  if (key === 'requestTypes') {
    return [...left.requestTypes].sort().join('|') !== [...right.requestTypes].sort().join('|')
  }
  return left[key] !== right[key]
}

/** 计算两份系统清单之间的结构化差异（新增 / 字段变更 / 退役移除）。 */
export function computeSystemDiff(
  baseSystems: DataSystem[],
  nextSystems: DataSystem[],
): SystemChange[] {
  const changes: SystemChange[] = []
  for (const next of nextSystems) {
    const base = baseSystems.find((item) => item.id === next.id)
    if (!base) {
      changes.push({ kind: 'added', systemId: next.id, systemName: next.name, fields: [] })
      continue
    }
    const fields = SYSTEM_FIELDS.filter(({ key }) => fieldChanged(base, next, key)).map(
      ({ label }) => label,
    )
    if (fields.length) {
      changes.push({ kind: 'updated', systemId: next.id, systemName: next.name, fields })
    }
  }
  for (const base of baseSystems) {
    if (!nextSystems.some((item) => item.id === base.id)) {
      changes.push({ kind: 'removed', systemId: base.id, systemName: base.name, fields: [] })
    }
  }
  return changes
}

/** 有效版本：最近一个已发布版本；没有时由调用方走回填。 */
export function getEffectiveVersion(state: WorkspaceState): InventoryVersion | undefined {
  return [...state.inventoryVersions]
    .filter((version) => version.status === 'published')
    .sort((left, right) => right.versionNo - left.versionNo)[0]
}

export function getVersion(state: WorkspaceState, versionId: string): InventoryVersion | undefined {
  return state.inventoryVersions.find((version) => version.id === versionId)
}

/**
 * 旧数据回填：为没有版本历史的工作区建立 v1 有效清单版本，
 * 给请求和任务补盖版本戳，回填完成后旧数据才参与后续重算。
 */
export function migrateState(state: WorkspaceState): WorkspaceState {
  if (!state.inventoryVersions) state.inventoryVersions = []
  if (!state.reconciliationBatches) state.reconciliationBatches = []
  if (state.inventoryVersions.some((version) => version.id === BASELINE_VERSION_ID)) {
    return state
  }
  const draft = cloneState(state)
  if (!Array.isArray(draft.inventoryVersions) || !draft.inventoryVersions.length) {
    draft.reconciliationBatches = draft.reconciliationBatches ?? []
    draft.inventoryVersions = [
      {
        id: BASELINE_VERSION_ID,
        versionNo: 1,
        status: 'published',
        baseVersionId: '',
        changeSummary: '旧数据回填：建立首个有效系统清单版本，历史请求统一挂靠该版本。',
        systems: cloneState(draft).systems,
        diff: [],
        submittedBy: '系统回填',
        submittedAt: '2026-09-01T00:00:00.000Z',
        publishedAt: '2026-09-01T00:00:00.000Z',
        publishedBy: '系统回填',
      },
    ]
    for (const request of draft.requests) {
      if (!request.inventoryVersionId) request.inventoryVersionId = BASELINE_VERSION_ID
      if (!request.reconciledVersionId) request.reconciledVersionId = BASELINE_VERSION_ID
      for (const task of request.tasks) {
        if (!task.generatedByVersionId) task.generatedByVersionId = BASELINE_VERSION_ID
      }
    }
    const backfillAudit: AuditEntry = {
      id: 'audit-inv-v1-backfill',
      action: '回填清单版本',
      operator: '系统回填',
      detail: '历史系统清单与请求任务已回填至 v1 有效版本，之后可参与发布重算。',
      createdAt: '2026-09-01T00:00:00.000Z',
    }
    draft.audit.unshift(backfillAudit)
  }
  return draft
}

export interface SubmitInventoryInput {
  baseVersionId: string
  changeSummary: string
  systems: DataSystem[]
  operator: string
}

export interface ReconcileResult {
  state: WorkspaceState
  outcome: 'pending' | 'draft' | 'failed' | 'completed' | 'amended'
  message: string
  versionId?: string
  batchId?: string
}

function appendGlobalAudit(
  state: WorkspaceState,
  entry: Omit<AuditEntry, 'id' | 'createdAt'> & { id: string; createdAt?: string },
) {
  if (state.audit.some((item) => item.id === entry.id)) return
  state.audit.unshift({ ...entry, createdAt: entry.createdAt ?? now() })
}

function appendRequestAudit(
  request: PrivacyRequest,
  id: string,
  action: string,
  operator: string,
  detail: string,
  createdAt: string,
) {
  if (request.audit.some((item) => item.id === id)) return
  request.audit.unshift({ id, action, operator, detail, createdAt })
}

/**
 * 管理员提交清单变更。
 * 同一基线版本只放行一个待生效版本：
 * - 同一管理员再次提交视为修订，覆盖原待生效版本；
 * - 不同管理员后到者保留为冲突草稿，不进入待生效队列。
 */
export function submitInventoryChange(
  state: WorkspaceState,
  input: SubmitInventoryInput,
): ReconcileResult {
  const migrated = migrateState(state)
  const draft = cloneState(migrated)
  const base = draft.inventoryVersions.find((version) => version.id === input.baseVersionId)
  if (!base) throw new Error('基线清单版本不存在')
  if (base.status !== 'published') throw new Error('只能基于当前有效版本提交变更')

  const diff = computeSystemDiff(base.systems, input.systems)
  if (!diff.length) throw new Error('提交的清单与有效版本完全一致，没有可发布的变更')

  const versionNo = Math.max(...draft.inventoryVersions.map((version) => version.versionNo)) + 1
  const versionId = `inv-v${versionNo}`
  const existingPending = draft.inventoryVersions.find(
    (version) => version.status === 'pending' && version.baseVersionId === base.id,
  )

  if (existingPending && existingPending.submittedBy !== input.operator) {
    const version: InventoryVersion = {
      id: versionId,
      versionNo,
      status: 'draft',
      baseVersionId: base.id,
      changeSummary: input.changeSummary,
      systems: input.systems,
      diff,
      submittedBy: input.operator,
      submittedAt: now(),
      conflictWithVersionId: existingPending.id,
      conflictNote: `与 ${existingPending.submittedBy} 提交的待生效版本 ${existingPending.id} 基于同一基线 ${base.id}，该草稿被保留等待人工合并。`,
    }
    draft.inventoryVersions.push(version)
    appendGlobalAudit(draft, {
      id: `${versionId}-audit-submit`,
      action: '清单变更转为冲突草稿',
      operator: input.operator,
      detail: `${version.conflictNote} 差异 ${diff.length} 项。`,
    })
    draft.revision += 1
    return {
      state: draft,
      outcome: 'draft',
      message: `同一基线版本已被 ${existingPending.submittedBy} 抢先提交，你的变更已保留为草稿 ${versionId}，可在下方查看差异。`,
      versionId,
    }
  }

  if (existingPending) {
    existingPending.systems = input.systems
    existingPending.diff = diff
    existingPending.changeSummary = input.changeSummary
    existingPending.submittedAt = now()
    appendGlobalAudit(draft, {
      id: `${existingPending.id}-audit-amend-${draft.revision}`,
      action: '修订待生效清单版本',
      operator: input.operator,
      detail: `${input.changeSummary}（修订后差异 ${diff.length} 项）。`,
    })
    draft.revision += 1
    return {
      state: draft,
      outcome: 'amended',
      message: `已修订你提交的待生效版本 ${existingPending.id}。`,
      versionId: existingPending.id,
    }
  }

  const version: InventoryVersion = {
    id: versionId,
    versionNo,
    status: 'pending',
    baseVersionId: base.id,
    changeSummary: input.changeSummary,
    systems: input.systems,
    diff,
    submittedBy: input.operator,
    submittedAt: now(),
  }
  draft.inventoryVersions.push(version)
  appendGlobalAudit(draft, {
    id: `${versionId}-audit-submit`,
    action: '提交清单变更（待生效）',
    operator: input.operator,
    detail: `${input.changeSummary} 基于 ${base.id}，差异 ${diff.length} 项，等待发布对账。`,
  })
  draft.revision += 1
  return {
    state: draft,
    outcome: 'pending',
    message: `变更已进入待生效版本 ${versionId}，发布时将冻结受影响请求证据并补算任务。`,
    versionId,
  }
}

/** 放弃待生效版本或冲突草稿。 */
export function discardInventoryVersion(
  state: WorkspaceState,
  versionId: string,
  operator: string,
): WorkspaceState {
  const draft = cloneState(state)
  const version = draft.inventoryVersions.find((item) => item.id === versionId)
  if (!version) throw new Error('清单版本不存在')
  if (!['pending', 'draft'].includes(version.status)) {
    throw new Error('只能放弃待生效版本或冲突草稿')
  }
  version.status = 'rejected'
  appendGlobalAudit(draft, {
    id: `${versionId}-audit-discard`,
    action: '放弃清单草稿/待生效版本',
    operator,
    detail: `${versionId} 已放弃，未改变有效清单版本。`,
  })
  draft.revision += 1
  return draft
}

function buildBatchItems(
  state: WorkspaceState,
  version: InventoryVersion,
): ReconciliationItem[] {
  const changedIds = new Set(version.diff.map((change) => change.systemId))
  return state.requests
    .filter((request) => request.affectedSystemIds.some((id) => changedIds.has(id)))
    .map((request) => ({
      requestId: request.id,
      requestCode: request.code,
      status: 'pending' as const,
      evidenceFrozen: 0,
      tasksGenerated: 0,
      tasksBlocked: 0,
      detail: '',
    }))
}

/** 冻结请求在发布时点之前的全部证据，已冻结的不重复处理。 */
function freezeEvidence(
  request: PrivacyRequest,
  versionId: string,
  at: string,
): number {
  let count = 0
  for (const evidence of request.evidence) {
    if (!evidence.frozenAt) {
      evidence.frozenAt = at
      evidence.frozenByVersionId = versionId
      count += 1
    }
  }
  return count
}

/**
 * 对照新版本重算一个在途请求的任务：
 * - 已完成任务原样保留，不重复生成；
 * - 只补齐规范流程中缺失的任务（如新纳入支持范围的系统）；
 * - 新版本中退役 / 不再支持该请求类型的系统，其未完成任务置为阻断；
 * - 合并/复核/关闭等公共步骤按规范顺序重排。
 */
function reconcileTasks(
  request: PrivacyRequest,
  systems: DataSystem[],
  versionId: string,
): { generated: number; blocked: number } {
  const canonical = buildWorkflowSteps({
    requestId: request.id,
    type: request.type,
    systemIds: request.affectedSystemIds,
    requestedAt: request.requestedAt,
    dueAt: request.dueAt,
    initialStatus: request.status,
    systems,
    versionId,
  })
  const canonicalById = new Map(canonical.map((step) => [step.id, step]))
  const existingIds = new Set(request.tasks.map((task) => task.id))

  let generated = 0
  for (const step of canonical) {
    if (existingIds.has(step.id)) continue
    const newTask: PrivacyRequest['tasks'][number] = {
      ...step,
      status: 'pending',
      completedAt: undefined,
      exceptionReason: '',
    }
    if (step.systemId) {
      const system = systems.find((item) => item.id === step.systemId)
      if (!system || system.status === 'retired' || !system.requestTypes.includes(request.type)) {
        newTask.status = 'blocked'
        newTask.exceptionReason = `清单版本 ${versionId} 发布时该系统已退役或不再支持此类请求，任务暂停等待复核。`
      }
    }
    request.tasks.push(newTask)
    existingIds.add(step.id)
    generated += 1
  }

  let blocked = 0
  for (const task of request.tasks) {
    if (!task.systemId || ['completed', 'blocked'].includes(task.status)) continue
    const system = systems.find((item) => item.id === task.systemId)
    if (!system || system.status === 'retired' || !system.requestTypes.includes(request.type)) {
      task.status = 'blocked'
      task.exceptionReason =
        task.exceptionReason ||
        `清单版本 ${versionId} 发布：系统 ${system?.name ?? task.systemId} 已退役或不再支持 ${request.type}，转入复核。`
      blocked += 1
    }
    const order = canonicalById.get(task.id)?.order
    if (order) task.order = order
    if (!task.generatedByVersionId) task.generatedByVersionId = versionId
  }
  request.tasks.sort((left, right) => left.order - right.order)
  return { generated, blocked }
}

function finishSuccessfulBatch(
  draft: WorkspaceState,
  batch: ReconciliationBatch,
  version: InventoryVersion,
  at: string,
) {
  batch.status = 'completed'
  batch.completedAt = at
  batch.failureReason = undefined
  version.status = 'published'
  version.publishedAt = at
  version.publishedBy = batch.publishedBy
  for (const other of draft.inventoryVersions) {
    if (other.id !== version.id && other.status === 'published') other.status = 'superseded'
  }
  draft.systems = version.systems.map((system) => ({ ...system }))
  appendGlobalAudit(draft, {
    id: `${batch.id}-audit-complete`,
    action: '清单版本发布完成',
    operator: batch.publishedBy,
    detail: `${version.id}（v${version.versionNo}）已成为有效版本；对账批次 ${batch.items.length} 个请求全部完成，总览、详情、清单与导出统一按该版本呈现。`,
    createdAt: at,
  })
}

/**
 * 从检查点继续执行批次。幂等：
 * - 已完成的 item（nextIndex 之前）不再处理，不重复补任务；
 * - 审计使用稳定 ID，续跑不会产生重复审计；
 * - simulateFailure 仅用于演示发布中途失败：处理完至少一个 item 后落检查点并中断。
 */
function runBatch(
  state: WorkspaceState,
  batchId: string,
  simulateFailure: boolean,
): ReconcileResult {
  const draft = cloneState(state)
  const batch = draft.reconciliationBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('对账批次不存在')
  const version = draft.inventoryVersions.find((item) => item.id === batch.versionId)
  if (!version) throw new Error('批次对应的清单版本不存在')

  let index = batch.nextIndex
  while (index < batch.items.length) {
    const item = batch.items[index]
    const request = draft.requests.find((entry) => entry.id === item.requestId)
    const at = now()
    if (!request) {
      item.status = 'skipped'
      item.detail = '请求已不存在，跳过。'
      item.processedAt = at
    } else if (CLOSED_STATUSES.includes(request.status)) {
      // 已完成/已拒绝请求：只冻结原始回执，绝不重算任务。
      item.evidenceFrozen = freezeEvidence(request, version.id, at)
      item.status = 'skipped'
      item.detail = '请求已关闭，保留已完成任务与原始回执，仅冻结证据不参与重算。'
      item.processedAt = at
      request.reconciledVersionId = version.id
      appendRequestAudit(
        request,
        `${batch.id}-audit-${request.id}`,
        '发布冻结历史回执',
        batch.publishedBy,
        `清单 ${version.id} 发布：冻结 ${item.evidenceFrozen} 份原始回执，历史任务保持可查不变。`,
        at,
      )
      appendGlobalAudit(draft, {
        id: `${batch.id}-audit-${request.id}`,
        requestId: request.id,
        action: '发布冻结历史回执',
        operator: batch.publishedBy,
        detail: `${request.code}：${item.detail}`,
        createdAt: at,
      })
    } else {
      item.evidenceFrozen = freezeEvidence(request, version.id, at)
      const { generated, blocked } = reconcileTasks(request, version.systems, version.id)
      item.tasksGenerated = generated
      item.tasksBlocked = blocked
      item.status = 'done'
      item.detail = `冻结证据 ${item.evidenceFrozen} 份，补生成缺失任务 ${generated} 项${blocked ? `，退役/失配任务阻断 ${blocked} 项` : ''}，已完成任务保持不变。`
      item.processedAt = at
      request.reconciledVersionId = version.id
      appendRequestAudit(
        request,
        `${batch.id}-audit-${request.id}`,
        '清单发布对账重算',
        batch.publishedBy,
        `按清单 ${version.id} 对账：${item.detail}`,
        at,
      )
      appendGlobalAudit(draft, {
        id: `${batch.id}-audit-${request.id}`,
        requestId: request.id,
        action: '清单发布对账重算',
        operator: batch.publishedBy,
        detail: `${request.code}：${item.detail}`,
        createdAt: at,
      })
    }

    index += 1
    batch.nextIndex = index
    draft.revision += 1

    // 演示用失败点：写完至少一个 item 的检查点后中断，状态随返回值持久化。
    if (simulateFailure && index < batch.items.length) {
      batch.status = 'failed'
      batch.failureReason = '模拟发布过程中断（如对账服务不可用），已保存检查点，可续跑补齐。'
      return {
        state: draft,
        outcome: 'failed',
        message: batch.failureReason,
        versionId: version.id,
        batchId: batch.id,
      }
    }
  }

  const at = now()
  finishSuccessfulBatch(draft, batch, version, at)
  draft.revision += 1
  return {
    state: draft,
    outcome: 'completed',
    message: `版本 ${version.id} 已发布，${batch.items.length} 个受影响请求对账完成。`,
    versionId: version.id,
    batchId: batch.id,
  }
}

/** 发布待生效版本：建立对账批次，冻结证据并逐项补算缺失任务。 */
export function publishInventoryVersion(
  state: WorkspaceState,
  versionId: string,
  operator: string,
  simulateFailure = false,
): ReconcileResult {
  const migrated = migrateState(state)
  const draft = cloneState(migrated)
  const version = draft.inventoryVersions.find((item) => item.id === versionId)
  if (!version) throw new Error('清单版本不存在')
  if (version.status !== 'pending') throw new Error('只有待生效版本可以发布')

  const existing = draft.reconciliationBatches.find((batch) => batch.versionId === versionId)
  if (existing) {
    return retryBatch(draft, existing.id, operator, simulateFailure)
  }

  const items = buildBatchItems(draft, version)
  const batchId = `batch-${version.id}`
  const batch: ReconciliationBatch = {
    id: batchId,
    versionId,
    versionNo: version.versionNo,
    status: 'processing',
    publishedBy: operator,
    createdAt: now(),
    nextIndex: 0,
    items,
  }
  draft.reconciliationBatches.push(batch)
  appendGlobalAudit(draft, {
    id: `${batchId}-audit-start`,
    action: '开始发布清单版本',
    operator,
    detail: `${version.id}（v${version.versionNo}）开始对账，受影响请求 ${items.length} 个：${items
      .map((item) => item.requestCode)
      .join('、') || '无'}。`,
  })
  draft.revision += 1
  return runBatch(draft, batchId, simulateFailure)
}

/** 续跑失败批次：只补未完成项，不重复任务和审计。 */
export function retryBatch(
  state: WorkspaceState,
  batchId: string,
  operator: string,
  simulateFailure = false,
): ReconcileResult {
  const migrated = migrateState(state)
  const batch = migrated.reconciliationBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('对账批次不存在')
  if (batch.status === 'completed') {
    return {
      state: migrated,
      outcome: 'completed',
      message: `批次 ${batchId} 已完成，无需重复执行。`,
      batchId,
      versionId: batch.versionId,
    }
  }
  const draft = cloneState(migrated)
  const live = draft.reconciliationBatches.find((item) => item.id === batchId)!
  live.publishedBy = operator || live.publishedBy
  appendGlobalAudit(draft, {
    id: `${batchId}-audit-retry`,
    action: '续跑对账批次',
    operator,
    detail: `从检查点第 ${live.nextIndex + 1} 项续跑，仅处理未完成项，不重复已生成任务和审计。`,
  })
  draft.revision += 1
  return runBatch(draft, batchId, simulateFailure)
}
