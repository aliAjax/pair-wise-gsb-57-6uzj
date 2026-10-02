import type { WorkspaceState } from '@/types/domain'
import { backfillWorkspaceRaw } from '@/services/inventoryService'
import { workspaceStateSchema } from './schemas'

const STORAGE_KEY = 'privacy-rights-workbench-v1'

export function loadWorkspace(): WorkspaceState | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    // 旧版本数据先回填清单版本，再按新结构校验，保证历史工作区可迁移。
    const parsed = workspaceStateSchema.safeParse(backfillWorkspaceRaw(JSON.parse(raw)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function saveWorkspace(state: WorkspaceState): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function clearWorkspace(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY)
}
