import { TRPCError, initTRPC } from '@trpc/server'
import {
  discardInventoryDraft,
  normalizeWorkspace,
  publishInventoryVersion,
  rebaseInventoryDraft,
  resumePublishBatch,
  saveInventoryDraft,
  submitInventoryDraft,
  withdrawInventoryVersion,
} from '@/services/inventoryService'
import {
  addComment,
  addConflict,
  addEvidence,
  assignTask,
  closeRequest,
  createRequest,
  extendRequest,
  recordExport,
  resolveConflict,
  saveRequest,
  taskAction,
  verifyIdentity,
} from '@/services/requestService'
import { createInitialState } from '@/services/mockData'
import {
  assignTaskInputSchema,
  closeRequestInputSchema,
  commentInputSchema,
  conflictInputSchema,
  createRequestInputSchema,
  evidenceInputSchema,
  extendRequestInputSchema,
  identityInputSchema,
  inventoryDraftActionInputSchema,
  publishInventoryInputSchema,
  recordExportInputSchema,
  resolveConflictInputSchema,
  resumePublishBatchInputSchema,
  saveInventoryDraftInputSchema,
  saveRequestInputSchema,
  taskActionInputSchema,
  withdrawInventoryVersionInputSchema,
} from '@/lib/schemas'
import type { WorkspaceState } from '@/types/domain'

const t = initTRPC.create()
const publicProcedure = t.procedure

function execute(operation: () => WorkspaceState): WorkspaceState {
  try {
    return operation()
  } catch (error) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error instanceof Error ? error.message : '请求处理失败',
    })
  }
}

export const appRouter = t.router({
  workspace: t.router({
    defaults: publicProcedure.query(() => createInitialState()),
  }),
  request: t.router({
    create: publicProcedure
      .input(createRequestInputSchema)
      .mutation(({ input }) =>
        execute(() => createRequest(input.state, input.input, input.operator)),
      ),
    save: publicProcedure
      .input(saveRequestInputSchema)
      .mutation(({ input }) =>
        execute(() => saveRequest(input.state, input.requestId, input.patch, input.operator)),
      ),
    verifyIdentity: publicProcedure
      .input(identityInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          verifyIdentity(input.state, input.requestId, input.status, input.note, input.operator),
        ),
      ),
    assignTask: publicProcedure
      .input(assignTaskInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          assignTask(
            input.state,
            input.requestId,
            input.taskId,
            input.assignee,
            input.operator,
          ),
        ),
      ),
    taskAction: publicProcedure
      .input(taskActionInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          taskAction(
            input.state,
            input.requestId,
            input.taskId,
            input.action,
            input.note,
            input.operator,
          ),
        ),
      ),
    addEvidence: publicProcedure
      .input(evidenceInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          addEvidence(
            input.state,
            input.requestId,
            input.taskId,
            input.name,
            input.evidenceType,
            input.operator,
          ),
        ),
      ),
    addConflict: publicProcedure
      .input(conflictInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          addConflict(input.state, input.requestId, input.conflict, input.operator),
        ),
      ),
    resolveConflict: publicProcedure
      .input(resolveConflictInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          resolveConflict(
            input.state,
            input.requestId,
            input.conflictIndex,
            input.resolution,
            input.operator,
          ),
        ),
      ),
    extend: publicProcedure
      .input(extendRequestInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          extendRequest(
            input.state,
            input.requestId,
            input.days,
            input.reason,
            input.operator,
          ),
        ),
      ),
    close: publicProcedure
      .input(closeRequestInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          closeRequest(
            input.state,
            input.requestId,
            input.resultSummary,
            input.closureReason,
            input.operator,
          ),
        ),
      ),
    comment: publicProcedure
      .input(commentInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          addComment(input.state, input.requestId, input.content, input.operator),
        ),
      ),
    recordExport: publicProcedure
      .input(recordExportInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          recordExport(input.state, input.scope, input.count, input.operator),
        ),
      ),
  }),
  inventory: t.router({
    saveDraft: publicProcedure
      .input(saveInventoryDraftInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          saveInventoryDraft(input.state, input.systems, input.note, input.operator),
        ),
      ),
    submitDraft: publicProcedure
      .input(inventoryDraftActionInputSchema)
      .mutation(({ input }) =>
        execute(() => submitInventoryDraft(input.state, input.draftId, input.operator)),
      ),
    rebaseDraft: publicProcedure
      .input(inventoryDraftActionInputSchema)
      .mutation(({ input }) =>
        execute(() => rebaseInventoryDraft(input.state, input.draftId, input.operator)),
      ),
    discardDraft: publicProcedure
      .input(inventoryDraftActionInputSchema)
      .mutation(({ input }) =>
        execute(() => discardInventoryDraft(input.state, input.draftId, input.operator)),
      ),
    withdrawVersion: publicProcedure
      .input(withdrawInventoryVersionInputSchema)
      .mutation(({ input }) =>
        execute(() => withdrawInventoryVersion(input.state, input.operator)),
      ),
    publish: publicProcedure
      .input(publishInventoryInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          publishInventoryVersion(input.state, input.operator, input.simulateFailureAfter),
        ),
      ),
    resumeBatch: publicProcedure
      .input(resumePublishBatchInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          resumePublishBatch(
            input.state,
            input.batchId,
            input.operator,
            input.simulateFailureAfter,
          ),
        ),
      ),
  }),
})

export type AppRouter = typeof appRouter
