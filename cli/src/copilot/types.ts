import type { CopilotPermissionMode } from '@hamlet/protocol/types';
import type { CopilotAgentMode } from '@hamlet/protocol';

export type PermissionMode = CopilotPermissionMode;

export interface CopilotMode {
    permissionMode: PermissionMode;
    model?: string;
    agentMode?: CopilotAgentMode;
}
