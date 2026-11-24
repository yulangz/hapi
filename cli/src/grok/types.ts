import type { GrokPermissionMode } from '@hamlet/protocol/types'

export type PermissionMode = GrokPermissionMode

export interface GrokMode {
    permissionMode: PermissionMode
    model?: string | null
    effort?: string | null
}
