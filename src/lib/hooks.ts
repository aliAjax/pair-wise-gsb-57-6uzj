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
    if (cached) queryClient.setQueryData(workspaceQueryKey, cached)
  }, [queryClient])

  useEffect(() => {
    if (query.data) saveWorkspace(query.data)
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

export function useSaveInventoryDraftMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.inventory.saveDraft.mutate>[0], 'state'>, state) =>
      trpc.inventory.saveDraft.mutate({ ...input, state }),
  )
}

export function useSubmitInventoryDraftMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.inventory.submitDraft.mutate>[0], 'state'>, state) =>
      trpc.inventory.submitDraft.mutate({ ...input, state }),
  )
}

export function useRebaseInventoryDraftMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.inventory.rebaseDraft.mutate>[0], 'state'>, state) =>
      trpc.inventory.rebaseDraft.mutate({ ...input, state }),
  )
}

export function useDiscardInventoryDraftMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.inventory.discardDraft.mutate>[0], 'state'>, state) =>
      trpc.inventory.discardDraft.mutate({ ...input, state }),
  )
}

export function useWithdrawInventoryVersionMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.inventory.withdrawVersion.mutate>[0], 'state'>, state) =>
      trpc.inventory.withdrawVersion.mutate({ ...input, state }),
  )
}

export function usePublishInventoryMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.inventory.publish.mutate>[0], 'state'>, state) =>
      trpc.inventory.publish.mutate({ ...input, state }),
  )
}

export function useResumePublishBatchMutation() {
  return useWorkspaceMutation(
    (input: Omit<Parameters<typeof trpc.inventory.resumeBatch.mutate>[0], 'state'>, state) =>
      trpc.inventory.resumeBatch.mutate({ ...input, state }),
  )
}

export type { PrivacyRequest }
