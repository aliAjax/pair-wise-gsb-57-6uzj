import { z } from 'zod'

export const requestTypeSchema = z.enum([
  'access',
  'rectification',
  'deletion',
  'withdraw-consent',
  'restriction',
])

export const requestStatusSchema = z.enum([
  'registered',
  'identity-review',
  'processing',
  'review-required',
  'pending-close',
  'completed',
  'rejected',
  'extended',
])

export const regionSchema = z.enum(['cn', 'eu', 'us', 'sg'])

export const identitySchema = z.object({
  status: z.enum(['pending', 'verified', 'insufficient']),
  materialType: z.enum(['masked-id', 'account-ownership', 'authorization-letter', 'none']),
  maskedReference: z.string(),
  protectedDigest: z.string(),
  note: z.string(),
  reviewedAt: z.string().optional(),
})

export const workflowStepSchema = z.object({
  id: z.string(),
  order: z.number(),
  name: z.string(),
  role: z.string(),
  systemId: z.string().optional(),
  status: z.enum(['pending', 'active', 'completed', 'blocked']),
  assignee: z.string(),
  dueAt: z.string(),
  completedAt: z.string().optional(),
  exceptionReason: z.string(),
  generatedByVersionId: z.string().optional(),
})

export const evidenceSchema = z.object({
  id: z.string(),
  stepId: z.string(),
  name: z.string(),
  evidenceType: z.enum(['execution-log', 'screenshot', 'signed-record', 'system-response']),
  digest: z.string(),
  uploadedBy: z.string(),
  uploadedAt: z.string(),
  protected: z.literal(true),
  frozenAt: z.string().optional(),
  frozenByVersionId: z.string().optional(),
})

export const commentSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  author: z.string(),
  content: z.string(),
  createdAt: z.string(),
})

export const auditEntrySchema = z.object({
  id: z.string(),
  requestId: z.string().optional(),
  action: z.string(),
  operator: z.string(),
  detail: z.string(),
  createdAt: z.string(),
})

export const dataSystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string(),
  dataDomain: z.string(),
  transferMethod: z.string(),
  slaDays: z.number(),
  requestTypes: z.array(requestTypeSchema),
  status: z.enum(['active', 'maintenance', 'retired']),
})

export const privacyRequestSchema = z.object({
  id: z.string(),
  code: z.string(),
  requesterName: z.string(),
  requesterContact: z.string(),
  region: regionSchema,
  type: requestTypeSchema,
  status: requestStatusSchema,
  identity: identitySchema,
  requestedAt: z.string(),
  dueAt: z.string(),
  extendedDays: z.number(),
  duplicateOf: z.string().optional(),
  affectedSystemIds: z.array(z.string()),
  inventoryVersionId: z.string().optional(),
  reconciledVersionId: z.string().optional(),
  tasks: z.array(workflowStepSchema),
  evidence: z.array(evidenceSchema),
  conflicts: z.array(z.string()),
  resultSummary: z.string(),
  closureReason: z.string(),
  audit: z.array(
    auditEntrySchema.omit({ requestId: true }),
  ),
})

export const systemChangeKindSchema = z.enum(['added', 'updated', 'removed'])

export const systemChangeSchema = z.object({
  kind: systemChangeKindSchema,
  systemId: z.string(),
  systemName: z.string(),
  fields: z.array(z.string()).default([]),
})

export const inventoryVersionSchema = z.object({
  id: z.string(),
  versionNo: z.number().int().nonnegative(),
  status: z.enum(['draft', 'pending', 'published', 'superseded', 'rejected']),
  baseVersionId: z.string(),
  changeSummary: z.string(),
  systems: z.array(dataSystemSchema),
  diff: z.array(systemChangeSchema).default([]),
  submittedBy: z.string(),
  submittedAt: z.string(),
  publishedAt: z.string().optional(),
  publishedBy: z.string().optional(),
  conflictWithVersionId: z.string().optional(),
  conflictNote: z.string().optional(),
})

export const batchItemStatusSchema = z.enum(['pending', 'done', 'skipped'])

export const reconciliationItemSchema = z.object({
  requestId: z.string(),
  requestCode: z.string(),
  status: batchItemStatusSchema,
  evidenceFrozen: z.number().default(0),
  tasksGenerated: z.number().default(0),
  tasksBlocked: z.number().default(0),
  detail: z.string().default(''),
  processedAt: z.string().optional(),
})

export const reconciliationBatchSchema = z.object({
  id: z.string(),
  versionId: z.string(),
  versionNo: z.number().int().nonnegative(),
  status: z.enum(['processing', 'failed', 'completed']),
  publishedBy: z.string(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  failureReason: z.string().optional(),
  nextIndex: z.number().int().nonnegative().default(0),
  items: z.array(reconciliationItemSchema),
})

export const workspaceStateSchema = z.object({
  requests: z.array(privacyRequestSchema),
  systems: z.array(dataSystemSchema),
  comments: z.array(commentSchema),
  audit: z.array(auditEntrySchema),
  revision: z.number(),
  inventoryVersions: z.array(inventoryVersionSchema).default([]),
  reconciliationBatches: z.array(reconciliationBatchSchema).default([]),
})

export const saveRequestInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  patch: privacyRequestSchema.partial(),
  operator: z.string().default('当前用户'),
})

export const createRequestInputSchema = z.object({
  state: workspaceStateSchema,
  input: z.object({
    requesterName: z.string().min(2),
    requesterContact: z.string().min(5),
    region: regionSchema,
    type: requestTypeSchema,
    affectedSystemIds: z.array(z.string()).min(1),
    identityMaterialType: identitySchema.shape.materialType,
    identityReference: z.string(),
    note: z.string(),
  }),
  operator: z.string().default('客服专员'),
})

export const identityInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  status: z.enum(['verified', 'insufficient']),
  note: z.string(),
  operator: z.string(),
})

export const assignTaskInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  taskId: z.string(),
  assignee: z.string().min(2),
  operator: z.string(),
})

export const taskActionInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  taskId: z.string(),
  action: z.enum(['start', 'complete', 'block']),
  note: z.string(),
  operator: z.string(),
})

export const evidenceInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  taskId: z.string(),
  name: z.string().min(2),
  evidenceType: evidenceSchema.shape.evidenceType,
  operator: z.string(),
})

export const conflictInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  conflict: z.string().min(4),
  operator: z.string(),
})

export const resolveConflictInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  conflictIndex: z.number().int().nonnegative(),
  resolution: z.string().min(4),
  operator: z.string(),
})

export const closeRequestInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  resultSummary: z.string().min(4),
  closureReason: z.string(),
  operator: z.string(),
})

export const extendRequestInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  days: z.number().int().min(1).max(90),
  reason: z.string().min(4),
  operator: z.string(),
})

export const commentInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  content: z.string().min(2),
  operator: z.string(),
})

export const recordExportInputSchema = z.object({
  state: workspaceStateSchema,
  scope: z.string(),
  count: z.number().int().nonnegative(),
  operator: z.string(),
})

export const submitInventoryInputSchema = z.object({
  state: workspaceStateSchema,
  baseVersionId: z.string(),
  changeSummary: z.string().min(4),
  systems: z.array(dataSystemSchema).min(1),
  operator: z.string().min(2),
})

export const publishInventoryInputSchema = z.object({
  state: workspaceStateSchema,
  versionId: z.string(),
  operator: z.string().min(2),
  simulateFailure: z.boolean().default(false),
})

export const retryBatchInputSchema = z.object({
  state: workspaceStateSchema,
  batchId: z.string(),
  operator: z.string().min(2),
  simulateFailure: z.boolean().default(false),
})

export const discardInventoryInputSchema = z.object({
  state: workspaceStateSchema,
  versionId: z.string(),
  operator: z.string().min(2),
})

export type RequestType = z.infer<typeof requestTypeSchema>
export type RequestStatus = z.infer<typeof requestStatusSchema>
export type Region = z.infer<typeof regionSchema>
export type IdentityCheck = z.infer<typeof identitySchema>
export type WorkflowStep = z.infer<typeof workflowStepSchema>
export type ExecutionEvidence = z.infer<typeof evidenceSchema>
export type ReviewComment = z.infer<typeof commentSchema>
export type AuditEntry = z.infer<typeof auditEntrySchema>
export type DataSystem = z.infer<typeof dataSystemSchema>
export type PrivacyRequest = z.infer<typeof privacyRequestSchema>
export type WorkspaceState = z.infer<typeof workspaceStateSchema>
export type SystemChange = z.infer<typeof systemChangeSchema>
export type InventoryVersion = z.infer<typeof inventoryVersionSchema>
export type ReconciliationBatch = z.infer<typeof reconciliationBatchSchema>
export type ReconciliationItem = z.infer<typeof reconciliationItemSchema>

export const requestTypeLabels: Record<RequestType, string> = {
  access: '访问',
  rectification: '更正',
  deletion: '删除',
  'withdraw-consent': '撤回同意',
  restriction: '限制处理',
}

export const requestStatusLabels: Record<RequestStatus, string> = {
  registered: '已登记',
  'identity-review': '身份核验中',
  processing: '履约处理中',
  'review-required': '复核队列',
  'pending-close': '待关闭',
  completed: '已完成',
  rejected: '已拒绝',
  extended: '已延期',
}

export const regionLabels: Record<Region, string> = {
  cn: '中国大陆',
  eu: '欧盟',
  us: '美国加州',
  sg: '新加坡',
}

export const systemStatusLabels: Record<DataSystem['status'], string> = {
  active: '在用',
  maintenance: '维护中',
  retired: '已退役',
}

export const inventoryVersionStatusLabels: Record<InventoryVersion['status'], string> = {
  draft: '冲突草稿',
  pending: '待生效',
  published: '有效版本',
  superseded: '已替代',
  rejected: '已放弃',
}

export const systemChangeKindLabels: Record<SystemChange['kind'], string> = {
  added: '新增',
  updated: '变更',
  removed: '退役/移除',
}

export const batchStatusLabels: Record<ReconciliationBatch['status'], string> = {
  processing: '对账进行中',
  failed: '中断待续跑',
  completed: '发布完成',
}

export const batchItemStatusLabels: Record<ReconciliationItem['status'], string> = {
  pending: '待处理',
  done: '已完成',
  skipped: '已跳过',
}
