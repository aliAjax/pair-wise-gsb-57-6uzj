import type {
  DataSystem,
  InventoryDraft,
  InventoryVersion,
  PrivacyRequest,
  PublishBatch,
  PublishBatchItem,
  WorkspaceState,
} from '@/types/domain'
import { requestTypeLabels, systemStatusLabels } from '@/lib/schemas'

const cloneState = (state: WorkspaceState): WorkspaceState => structuredClone(state)
const now = () => new Date().toISOString()
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

const OPEN_STATUSES = ['registered', 'identity-review', 'processing', 'review-required', 'pending-close', 'extended']
const isOpen = (request: PrivacyRequest) => OPEN_STATUSES.includes(request.status)

/**
 * 旧数据回填：缺少清单版本信息的工作区先补出 v1 有效版本，
 * 并把全部请求对齐到该版本，之后才能参与重算。幂等。
 */
export function normalizeWorkspace(state: WorkspaceState): WorkspaceState {
  const draft = state as WorkspaceState & {
    inventory?: WorkspaceState['inventory']
    publishBatches?: PublishBatch[]
  }
  if (!draft.inventory || !draft.inventory.activeVersionId) {
    const version: InventoryVersion = {
      id: 'inv-v1',
      version: 1,
      systems: structuredClone(draft.systems ?? []),
      status: 'effective',
      note: '初始清单版本（历史数据回填）',
      createdBy: '系统回填',
      createdAt: now(),
      publishedAt: now(),
    }
    draft.inventory = { versions: [version], activeVersionId: version.id, drafts: [] }
  }
  if (!Array.isArray(draft.publishBatches)) draft.publishBatches = []
  const activeVersionId = draft.inventory.activeVersionId
  for (const request of draft.requests ?? []) {
    if (!request.inventoryVersionId) request.inventoryVersionId = activeVersionId
  }
  return draft as WorkspaceState
}

/** localStorage 旧数据在 schema 校验前的原始回填，保证旧工作区可迁移而非丢弃。 */
export function backfillWorkspaceRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const state = raw as Record<string, unknown> & {
    requests?: Array<Record<string, unknown>>
    systems?: DataSystem[]
  }
  if (!Array.isArray(state.publishBatches)) state.publishBatches = []
  const inventory = state.inventory as { activeVersionId?: string } | undefined
  if (!inventory || typeof inventory !== 'object' || !inventory.activeVersionId) {
    state.inventory = {
      versions: [
        {
          id: 'inv-v1',
          version: 1,
          systems: state.systems ?? [],
          status: 'effective',
          note: '初始清单版本（历史数据回填）',
          createdBy: '系统回填',
          createdAt: now(),
          publishedAt: now(),
        },
      ],
      activeVersionId: 'inv-v1',
      drafts: [],
    }
  }
  const activeVersionId = (state.inventory as { activeVersionId: string }).activeVersionId
  for (const request of state.requests ?? []) {
    if (!request.inventoryVersionId) request.inventoryVersionId = activeVersionId
  }
  return state
}

export interface SystemDiff {
  added: DataSystem[]
  removed: DataSystem[]
  changed: Array<{ before: DataSystem; after: DataSystem; changes: string[] }>
}

export function diffSystems(base: DataSystem[], next: DataSystem[]): SystemDiff {
  const added = next.filter((system) => !base.some((item) => item.id === system.id))
  const removed = base.filter((system) => !next.some((item) => item.id === system.id))
  const changed: SystemDiff['changed'] = []
  for (const after of next) {
    const before = base.find((item) => item.id === after.id)
    if (!before) continue
    const changes: string[] = []
    if (before.status !== after.status) {
      changes.push(`状态 ${systemStatusLabels[before.status]} → ${systemStatusLabels[after.status]}`)
    }
    if (before.owner !== after.owner) changes.push(`责任团队 ${before.owner} → ${after.owner}`)
    if (before.slaDays !== after.slaDays) changes.push(`SLA ${before.slaDays} → ${after.slaDays} 天`)
    if (before.transferMethod !== after.transferMethod) {
      changes.push(`传输方式 ${before.transferMethod} → ${after.transferMethod}`)
    }
    if (before.dataDomain !== after.dataDomain) changes.push('数据域描述已调整')
    const addedTypes = after.requestTypes.filter((type) => !before.requestTypes.includes(type))
    const removedTypes = before.requestTypes.filter((type) => !after.requestTypes.includes(type))
    if (addedTypes.length || removedTypes.length) {
      const parts = [
        ...addedTypes.map((type) => `+${requestTypeLabels[type]}`),
        ...removedTypes.map((type) => `-${requestTypeLabels[type]}`),
      ]
      changes.push(`支持类型 ${parts.join(' ')}`)
    }
    if (changes.length) changed.push({ before, after, changes })
  }
  return { added, removed, changed }
}

export function diffSummaryLines(diff: SystemDiff): string[] {
  return [
    ...diff.added.map((system) => `新增系统：${system.name}（${system.owner}）`),
    ...diff.removed.map((system) => `移除系统：${system.name}`),
    ...diff.changed.map((item) => `修改 ${item.after.name}：${item.changes.join('；')}`),
  ]
}

export function isEmptyDiff(diff: SystemDiff): boolean {
  return !diff.added.length && !diff.removed.length && !diff.changed.length
}

export function effectiveVersion(state: WorkspaceState): InventoryVersion {
  const version = state.inventory.versions.find((item) => item.id === state.inventory.activeVersionId)
  if (!version) throw new Error('工作区缺少有效清单版本')
  return version
}

export function pendingVersion(state: WorkspaceState): InventoryVersion | undefined {
  return state.inventory.versions.find((item) => item.status === 'pending')
}

export function versionLabel(state: WorkspaceState, versionId: string | undefined): string {
  const version = state.inventory.versions.find((item) => item.id === versionId)
  return version ? `v${version.version}` : '未对齐'
}

function appendGlobalAudit(
  draft: WorkspaceState,
  action: string,
  operator: string,
  detail: string,
  entryId = id('audit'),
) {
  if (draft.audit.some((entry) => entry.id === entryId)) return
  draft.audit.unshift({ id: entryId, action, operator, detail, createdAt: now() })
}

function appendRequestAudit(
  draft: WorkspaceState,
  request: PrivacyRequest,
  action: string,
  operator: string,
  detail: string,
  entryId: string,
) {
  if (draft.audit.some((entry) => entry.id === entryId)) return
  draft.audit.unshift({ id: entryId, requestId: request.id, action, operator, detail, createdAt: now() })
  request.audit.unshift({ id: entryId, action, operator, detail, createdAt: now() })
}

/** 判断请求在新版本下是否失配：涉及系统被变更/移除，或缺少应有的履约任务。 */
function requestMismatch(request: PrivacyRequest, diff: SystemDiff, nextSystems: DataSystem[]): string[] {
  const reasons: string[] = []
  const changedIds = new Set([...diff.removed.map((s) => s.id), ...diff.changed.map((c) => c.after.id)])
  for (const systemId of request.affectedSystemIds) {
    if (changedIds.has(systemId)) reasons.push(`系统 ${systemId} 已变更`)
    const system = nextSystems.find((item) => item.id === systemId)
    const applicable =
      system && system.status !== 'retired' && system.requestTypes.includes(request.type)
    if (applicable && !request.tasks.some((task) => task.id === `${request.id}-locate-${systemId}`)) {
      reasons.push(`缺少 ${system.name} 履约任务`)
    }
  }
  return reasons
}

/**
 * 单个请求的重算：冻结证据、取消失配系统的未完成任务、补建缺失任务。
 * 已完成任务与原始回执保留可查；全程幂等，重试不会产生重复任务或审计。
 */
function recalculateRequest(
  draft: WorkspaceState,
  request: PrivacyRequest,
  version: InventoryVersion,
  batch: PublishBatch,
  diff: SystemDiff,
  operator: string,
): PublishBatchItem {
  const item: PublishBatchItem = { requestId: request.id, code: request.code, status: 'done', actions: [] }
  if (!isOpen(request)) {
    request.inventoryVersionId = version.id
    item.status = 'skipped'
    item.actions.push('历史请求：保留原始回执与任务记录，仅对齐版本标记')
    return item
  }
  const mismatch = requestMismatch(request, diff, version.systems)
  if (!mismatch.length) {
    request.inventoryVersionId = version.id
    item.status = 'skipped'
    item.actions.push('清单变更不影响该请求')
    return item
  }

  const timestamp = now()
  const unfrozen = request.evidence.filter((evidence) => !evidence.frozenAt)
  if (unfrozen.length) {
    for (const evidence of unfrozen) {
      evidence.frozenAt = timestamp
      evidence.frozenByBatchId = batch.id
    }
    item.actions.push(`冻结证据 ${unfrozen.length} 份（原始回执保留可查）`)
  }

  for (const systemId of request.affectedSystemIds) {
    const system = version.systems.find((entry) => entry.id === systemId)
    const applicable =
      system && system.status !== 'retired' && system.requestTypes.includes(request.type)
    const locateId = `${request.id}-locate-${systemId}`
    const executeId = `${request.id}-execute-${systemId}`

    if (!applicable) {
      const removable = request.tasks.filter(
        (task) => (task.id === locateId || task.id === executeId) && task.status !== 'completed',
      )
      if (removable.length) {
        request.tasks = request.tasks.filter((task) => !removable.some((entry) => entry.id === task.id))
        const reason = !system ? '系统已移除' : system.status === 'retired' ? '系统已退役' : '不再支持该请求类型'
        item.actions.push(`取消「${system?.name ?? systemId}」未完成任务 ${removable.length} 项（${reason}）`)
        const conflict = `清单 v${version.version} 重算：系统「${system?.name ?? systemId}」${reason}，未完成任务已取消，请确认替代处理路径。`
        if (!request.conflicts.includes(conflict)) {
          request.conflicts.push(conflict)
          request.status = 'review-required'
        }
      }
      continue
    }

    const missing: Array<'locate' | 'execute'> = []
    if (!request.tasks.some((task) => task.id === locateId)) missing.push('locate')
    if (!request.tasks.some((task) => task.id === executeId)) missing.push('execute')
    if (missing.length) {
      const mergeIndex = request.tasks.findIndex((task) => task.id.endsWith('-merge'))
      const insertAt = mergeIndex === -1 ? request.tasks.length : mergeIndex
      const created = missing.map((kind) => ({
        id: kind === 'locate' ? locateId : executeId,
        order: 0,
        name:
          kind === 'locate'
            ? `定位 ${system.name} 数据`
            : `${request.type === 'deletion' ? '执行删除' : request.type === 'rectification' ? '执行更正' : '执行请求'}：${system.name}`,
        role: system.owner,
        systemId,
        status: 'pending' as const,
        assignee: system.owner,
        dueAt: request.dueAt,
        exceptionReason: '',
      }))
      request.tasks.splice(insertAt, 0, ...created)
      item.actions.push(`补建「${system.name}」缺失任务 ${created.length} 项`)
      if (request.status === 'pending-close') request.status = 'processing'
    }

    for (const task of request.tasks) {
      if (
        (task.id === locateId || task.id === executeId) &&
        task.status !== 'completed' &&
        task.assignee !== system.owner
      ) {
        task.role = system.owner
        task.assignee = system.owner
        item.actions.push(`「${system.name}」任务责任人更新为 ${system.owner}`)
      }
    }
  }

  request.tasks.forEach((task, index) => {
    task.order = index + 1
  })
  request.inventoryVersionId = version.id
  appendRequestAudit(
    draft,
    request,
    '清单版本重算',
    operator,
    `清单 v${version.version} 发布重算：${item.actions.join('；')}。`,
    `audit-${batch.id}-${request.id}`,
  )
  return item
}

/**
 * 执行发布批次：逐请求重算并推进检查点。simulateFailureAfter 用于演示
 * 批次写到一半失败的情形——已完成的处理保留，重试只补未完成项。
 */
function runBatch(
  draft: WorkspaceState,
  version: InventoryVersion,
  batch: PublishBatch,
  operator: string,
  simulateFailureAfter?: number,
): void {
  const diff = diffSystems(effectiveVersion(draft).systems, version.systems)
  let processedThisRun = 0
  for (const item of batch.items) {
    if (item.status !== 'pending') continue
    const request = draft.requests.find((entry) => entry.id === item.requestId)
    if (!request) {
      item.status = 'skipped'
      item.actions.push('请求已不存在')
    } else {
      const result = recalculateRequest(draft, request, version, batch, diff, operator)
      item.status = result.status
      item.actions = result.actions
    }
    batch.checkpoint = batch.items.filter((entry) => entry.status !== 'pending').length
    processedThisRun += 1
    if (
      simulateFailureAfter !== undefined &&
      processedThisRun >= simulateFailureAfter &&
      batch.items.some((entry) => entry.status === 'pending')
    ) {
      batch.status = 'failed'
      batch.error = `批次写入中断：已在检查点 ${batch.checkpoint}/${batch.items.length} 处保留进度，重试只补未完成项。`
      appendGlobalAudit(
        draft,
        '发布批次中断',
        operator,
        `清单 v${version.version} 发布批次在 ${batch.checkpoint}/${batch.items.length} 处中断，检查点已保留。`,
        `audit-${batch.id}-failed-${batch.checkpoint}`,
      )
      return
    }
  }

  batch.status = 'completed'
  batch.finishedAt = now()
  batch.checkpoint = batch.items.length
  for (const entry of draft.inventory.versions) {
    if (entry.status === 'effective') entry.status = 'superseded'
  }
  version.status = 'effective'
  version.publishedAt = now()
  version.batchId = batch.id
  draft.inventory.activeVersionId = version.id
  draft.systems = structuredClone(version.systems)
  const recalculated = batch.items.filter((entry) => entry.status === 'done').length
  appendGlobalAudit(
    draft,
    '发布清单版本',
    operator,
    `清单 v${version.version} 已生效：重算 ${recalculated} 个请求，其余 ${batch.items.length - recalculated} 个保持原记录并对齐版本。`,
    `audit-${batch.id}-completed`,
  )
}

export function saveInventoryDraft(
  state: WorkspaceState,
  systems: DataSystem[],
  note: string,
  operator: string,
): WorkspaceState {
  const draft = cloneState(normalizeWorkspace(state))
  const existing = draft.inventory.drafts.find((entry) => entry.updatedBy === operator)
  if (existing) {
    existing.systems = structuredClone(systems)
    existing.note = note
    existing.updatedAt = now()
    if (existing.status === 'conflicted') {
      const winner = pendingVersion(draft) ?? effectiveVersion(draft)
      existing.conflictSummary = [
        `草稿基准版本未放行（当前${pendingVersion(draft) ? `待生效 v${winner.version}` : `有效 v${winner.version}`}），可重新提交或以有效版本重建。`,
        ...diffSummaryLines(diffSystems(winner.systems, existing.systems)).map(
          (line) => `与 v${winner.version} 差异：${line}`,
        ),
      ]
    } else {
      existing.baseVersionId = draft.inventory.activeVersionId
    }
  } else {
    const entry: InventoryDraft = {
      id: id('invdraft'),
      baseVersionId: draft.inventory.activeVersionId,
      systems: structuredClone(systems),
      note,
      updatedBy: operator,
      updatedAt: now(),
      status: 'editing',
    }
    draft.inventory.drafts.push(entry)
  }
  draft.revision += 1
  return draft
}

/**
 * 提交草稿为待生效版本。同一基准版本只放行一位提交者：
 * 已存在待生效版本或草稿基准过旧时，草稿保留并记录与胜出版本的差异。
 */
export function submitInventoryDraft(
  state: WorkspaceState,
  draftId: string,
  operator: string,
): WorkspaceState {
  const draft = cloneState(normalizeWorkspace(state))
  const myDraft = draft.inventory.drafts.find((entry) => entry.id === draftId)
  if (!myDraft) throw new Error('草稿不存在或已被提交')
  const pending = pendingVersion(draft)
  const stale = myDraft.baseVersionId !== draft.inventory.activeVersionId
  if (pending || stale) {
    const winner = pending ?? effectiveVersion(draft)
    myDraft.status = 'conflicted'
    myDraft.conflictSummary = [
      pending
        ? `清单 v${winner.version} 已由 ${winner.createdBy} 提交待生效，本次提交未放行。`
        : `清单有效版本已推进至 v${winner.version}，草稿基准版本过旧。`,
      ...diffSummaryLines(diffSystems(winner.systems, myDraft.systems)).map(
        (line) => `与 v${winner.version} 差异：${line}`,
      ),
    ]
    draft.revision += 1
    return draft
  }
  const base = effectiveVersion(draft)
  const diff = diffSystems(base.systems, myDraft.systems)
  if (isEmptyDiff(diff)) throw new Error('草稿与当前有效版本一致，无需提交')
  const version: InventoryVersion = {
    id: id('inv'),
    version: Math.max(0, ...draft.inventory.versions.map((entry) => entry.version)) + 1,
    systems: structuredClone(myDraft.systems),
    status: 'pending',
    baseVersionId: base.id,
    note: myDraft.note,
    createdBy: operator,
    createdAt: now(),
  }
  draft.inventory.versions.push(version)
  draft.inventory.drafts = draft.inventory.drafts.filter((entry) => entry.id !== draftId)
  for (const other of draft.inventory.drafts) {
    other.status = 'conflicted'
    other.conflictSummary = [
      `清单 v${version.version} 已由 ${operator} 抢先提交，本次提交未放行，草稿已保留。`,
      ...diffSummaryLines(diffSystems(version.systems, other.systems)).map(
        (line) => `与 v${version.version} 差异：${line}`,
      ),
    ]
  }
  appendGlobalAudit(
    draft,
    '提交清单版本',
    operator,
    `清单 v${version.version} 进入待生效：${diffSummaryLines(diff).join('；')}。`,
  )
  draft.revision += 1
  return draft
}

export function rebaseInventoryDraft(
  state: WorkspaceState,
  draftId: string,
  operator: string,
): WorkspaceState {
  const draft = cloneState(normalizeWorkspace(state))
  const myDraft = draft.inventory.drafts.find((entry) => entry.id === draftId)
  if (!myDraft) throw new Error('草稿不存在')
  const base = effectiveVersion(draft)
  myDraft.systems = structuredClone(base.systems)
  myDraft.baseVersionId = base.id
  myDraft.status = 'editing'
  myDraft.conflictSummary = undefined
  myDraft.updatedAt = now()
  appendGlobalAudit(draft, '重建清单草稿', operator, `草稿已以有效版本 v${base.version} 为基准重建。`)
  draft.revision += 1
  return draft
}

export function discardInventoryDraft(
  state: WorkspaceState,
  draftId: string,
  operator: string,
): WorkspaceState {
  const draft = cloneState(normalizeWorkspace(state))
  const before = draft.inventory.drafts.length
  draft.inventory.drafts = draft.inventory.drafts.filter((entry) => entry.id !== draftId)
  if (draft.inventory.drafts.length === before) throw new Error('草稿不存在')
  appendGlobalAudit(draft, '放弃清单草稿', operator, '未提交的清单修改已放弃。')
  draft.revision += 1
  return draft
}

/** 撤回待生效版本：版本回到创建人草稿，不发生任何重算。 */
export function withdrawInventoryVersion(state: WorkspaceState, operator: string): WorkspaceState {
  const draft = cloneState(normalizeWorkspace(state))
  const pending = pendingVersion(draft)
  if (!pending) throw new Error('没有待生效的清单版本')
  draft.inventory.versions = draft.inventory.versions.filter((entry) => entry.id !== pending.id)
  draft.inventory.drafts = draft.inventory.drafts.filter((entry) => entry.updatedBy !== pending.createdBy)
  draft.inventory.drafts.push({
    id: id('invdraft'),
    baseVersionId: draft.inventory.activeVersionId,
    systems: structuredClone(pending.systems),
    note: pending.note,
    updatedBy: pending.createdBy,
    updatedAt: now(),
    status: 'editing',
  })
  appendGlobalAudit(draft, '撤回待生效版本', operator, `清单 v${pending.version} 已撤回为草稿。`)
  draft.revision += 1
  return draft
}

export function publishInventoryVersion(
  state: WorkspaceState,
  operator: string,
  simulateFailureAfter?: number,
): WorkspaceState {
  const draft = cloneState(normalizeWorkspace(state))
  const version = pendingVersion(draft)
  if (!version) throw new Error('没有待发布的清单版本')
  const batch: PublishBatch = {
    id: id('batch'),
    versionId: version.id,
    version: version.version,
    status: 'running',
    checkpoint: 0,
    items: draft.requests.map((request) => ({
      requestId: request.id,
      code: request.code,
      status: 'pending',
      actions: [],
    })),
    startedAt: now(),
  }
  draft.publishBatches.unshift(batch)
  runBatch(draft, version, batch, operator, simulateFailureAfter)
  draft.revision += 1
  return draft
}

/** 从中断检查点续跑：只处理未完成项，已生成的任务与审计不会重复。 */
export function resumePublishBatch(
  state: WorkspaceState,
  batchId: string,
  operator: string,
  simulateFailureAfter?: number,
): WorkspaceState {
  const draft = cloneState(normalizeWorkspace(state))
  const batch = draft.publishBatches.find((entry) => entry.id === batchId)
  if (!batch) throw new Error('发布批次不存在')
  if (batch.status === 'completed') throw new Error('批次已完成，无需重试')
  const version = draft.inventory.versions.find((entry) => entry.id === batch.versionId)
  if (!version || version.status !== 'pending') throw new Error('批次对应的清单版本已失效')
  batch.status = 'running'
  batch.error = undefined
  runBatch(draft, version, batch, operator, simulateFailureAfter)
  draft.revision += 1
  return draft
}

/** 预览：若发布该清单，将有多少进行中的请求需要重算。 */
export function affectedRequestCount(state: WorkspaceState, nextSystems: DataSystem[]): number {
  const normalized = normalizeWorkspace(state)
  const diff = diffSystems(effectiveVersion(normalized).systems, nextSystems)
  return normalized.requests.filter(
    (request) => isOpen(request) && requestMismatch(request, diff, nextSystems).length > 0,
  ).length
}
