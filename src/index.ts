export { Agent, type AgentCreateOptions } from './core/agent.js';
export { LocalToolBackend, CompositeToolBackend, HOST_LLM_TOOLS, type ToolBackend } from './tools/backend.js';
export { RemoteToolBackend, type RemoteToolBackendOptions } from './tools/remote-backend.js';
export { runToolWorker, type ToolWorkerOptions } from './tools/worker.js';
export {
	setWorkspaceRoot,
	getWorkspaceRoot,
	resolveWorkspacePath,
	resolveWorkspaceFile,
	assertNoSymlinkComponents,
	isInsideWorkspace,
	WorkspacePathError,
} from './tools/workspace-path.js';
export type { ToolResult } from './tools/files.js';
