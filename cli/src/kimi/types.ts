import type { KimiPermissionMode } from '@hamlet/protocol/types';

export type PermissionMode = KimiPermissionMode;

export interface KimiMode {
    permissionMode: PermissionMode;
    model?: string;
}
