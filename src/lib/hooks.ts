'use client'

import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import { trpc } from './trpc'
import { loadWorkspace, saveWorkspace } from './localStore'
import { migrateState, type ReconcileResult } from '@/services/reconciliation'
import type { PrivacyRequest, WorkspaceState } from '@/types/domain'

export const workspaceQueryKey = ['privacy-workspace'] as const

export function useWorkspaceQuery() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: workspaceQueryKey,
    queryFn: () => trpc.workspace.defaults.query(),
    staleTime: Number.POSITIVE_INFINITY,
  })

  useEffect(() => {
    const cached = loadWorkspace()
    if (cached) {
      // 旧数据先回填清单版本，再进入工作区参与后续重算。
      const migrated = migrateState(cached)
      queryClient.setQueryData(workspaceQueryKey, migrated)
      if (migrated !== cached) saveWorkspace(migrated)
    }
  }, [queryClient])

  useEffect(() => {
    if (query.data) {
      const migrated = migrateState(query.data)
      saveWorkspace(migrated)
      if (migrated !== query.data) queryClient.setQueryData(workspaceQueryKey, migrated)
    }
  }, [query.data])

  return query
}

function useWorkspaceMutation<TInput>(
  perform: (input: TInput, state: WorkspaceState) => Promise<WorkspaceState>,
): UseMutationResult<WorkspaceState, Error, TInput> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: TInput) => {
      const state =
        queryClient.getQueryData<WorkspaceState>(workspaceQueryKey) ?? loadWorkspace()
      if (!state) throw new Error('本地工作区尚未加载')
      return perform(input, state)
    },
    onSuccess: (state) => {
      saveWorkspace(state)
      queryClient.setQueryData(workspaceQueryKey, state)
    },
  })
}

export function useCreateRequestMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.request.create.mutate>[0], 'state'>, state) =>
      trpc.request.create.mutate({ ...input, state }),
  )
}

export function useSaveRequestMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.request.save.mutate>[0], 'state'>, state) =>
      trpc.request.save.mutate({ ...input, state }),
  )
}

export function useVerifyIdentityMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.request.verifyIdentity.mutate>[0], 'state'>, state) =>
      trpc.request.verifyIdentity.mutate({ ...input, state }),
  )
}

export function useAssignTaskMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.request.assignTask.mutate>[0], 'state'>, state) =>
      trpc.request.assignTask.mutate({ ...input, state }),
  )
}

export function useTaskActionMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.request.taskAction.mutate>[0], 'state'>, state) =>
      trpc.request.taskAction.mutate({ ...input, state }),
  )
}

export function useAddEvidenceMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.request.addEvidence.mutate>[0], 'state'>, state) =>
      trpc.request.addEvidence.mutate({ ...input, state }),
  )
}

export function useAddConflictMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.request.addConflict.mutate>[0], 'state'>, state) =>
      trpc.request.addConflict.mutate({ ...input, state }),
  )
}

export function useResolveConflictMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.request.resolveConflict.mutate>[0], 'state'>, state) =>
      trpc.request.resolveConflict.mutate({ ...input, state }),
  )
}

export function useExtendRequestMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.request.extend.mutate>[0], 'state'>, state) =>
      trpc.request.extend.mutate({ ...input, state }),
  )
}

export function useCloseRequestMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.request.close.mutate>[0], 'state'>, state) =>
      trpc.request.close.mutate({ ...input, state }),
  )
}

export function useAddCommentMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.request.comment.mutate>[0], 'state'>, state) =>
      trpc.request.comment.mutate({ ...input, state }),
  )
}

export function useRecordExportMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.request.recordExport.mutate>[0], 'state'>, state) =>
      trpc.request.recordExport.mutate({ ...input, state }),
  )
}

type SubmitInventoryInput = Omit<
  Parameters<typeof trpc.inventory.submit.mutate>[0],
  'state'
>
type PublishInventoryInput = Omit<
  Parameters<typeof trpc.inventory.publish.mutate>[0],
  'state'
>
type RetryBatchInput = Omit<Parameters<typeof trpc.inventory.retry.mutate>[0], 'state'>
type DiscardInventoryInput = Omit<
  Parameters<typeof trpc.inventory.discard.mutate>[0],
  'state'
>

/** 对账类操作返回 ReconcileResult：即使发布中途失败也要持久化检查点。 */
export function useInventoryMutation<TInput>(
  perform: (input: TInput, state: WorkspaceState) => Promise<ReconcileResult>,
): UseMutationResult<ReconcileResult, Error, TInput> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: TInput) => {
      const state =
        queryClient.getQueryData<WorkspaceState>(workspaceQueryKey) ?? loadWorkspace()
      if (!state) throw new Error('本地工作区尚未加载')
      return perform(input, migrateState(state))
    },
    onSuccess: (result) => {
      saveWorkspace(result.state)
      queryClient.setQueryData(workspaceQueryKey, result.state)
    },
  })
}

export function useSubmitInventoryMutation() {
  return useInventoryMutation<SubmitInventoryInput>((input, state) =>
    trpc.inventory.submit.mutate({ ...input, state }),
  )
}

export function usePublishInventoryMutation() {
  return useInventoryMutation<PublishInventoryInput>((input, state) =>
    trpc.inventory.publish.mutate({ ...input, state }),
  )
}

export function useRetryBatchMutation() {
  return useInventoryMutation<RetryBatchInput>((input, state) =>
    trpc.inventory.retry.mutate({ ...input, state }),
  )
}

export function useDiscardInventoryMutation() {
  return useWorkspaceMutation<DiscardInventoryInput>((input, state) =>
    trpc.inventory.discard.mutate({ ...input, state }),
  )
}

export type { PrivacyRequest }
