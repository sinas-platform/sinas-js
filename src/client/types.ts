export interface SinasConfig {
  apiBase: string;
  component: {
    namespace: string;
    name: string;
    version: string;
  };
  resources: {
    enabledAgents: string[];
    enabledFunctions: string[];
    enabledQueries: string[];
    enabledComponents: string[];
    enabledStores: Array<{ store: string; access: 'readonly' | 'readwrite' }>;
  };
  input: Record<string, unknown>;
}

export interface QueryResult {
  success: boolean;
  operation: string;
  data?: Record<string, unknown>[];
  rowCount?: number;
  affectedRows?: number;
  durationMs: number;
}

export interface FunctionResult {
  status: 'success' | 'timeout' | 'error';
  executionId: string;
  result?: unknown;
  error?: string;
}

export interface StateGetResult {
  found: boolean;
  key: string;
  value: unknown;
}

export interface StateListResult {
  items: Array<{ key: string; value: unknown }>;
}

export interface ChatCreateResult {
  id: string;
  agentNamespace: string;
  agentName: string;
  title: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export interface ToolCallInfo {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessageFull {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  toolCalls: ToolCallInfo[] | null;
  toolCallId: string | null;
  name: string | null;
  createdAt: string;
}

export interface ChatDetail {
  id: string;
  agentNamespace: string;
  agentName: string;
  title: string;
  messages: ChatMessageFull[];
  pendingApprovals: ApprovalRequest[];
}

export interface ApprovalRequest {
  type: string;
  toolCallId: string;
  functionNamespace: string;
  functionName: string;
  arguments: Record<string, unknown>;
}

export interface ApprovalResult {
  status: string;
  toolCallId: string;
  channelId: string;
}

// Multimodal content types
export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageContentPart {
  type: 'image';
  image: string;
}

export interface AudioContentPart {
  type: 'audio';
  data: string;
  format: string;
}

export interface FileContentPart {
  type: 'file';
  file_data: string;
  filename: string;
  mime_type: string;
}

export interface ComponentContentPart {
  type: 'component';
  render_token: string;
  namespace: string;
  name: string;
  title?: string;
  input?: Record<string, unknown>;
}

export type ContentPart =
  | TextContentPart
  | ImageContentPart
  | AudioContentPart
  | FileContentPart
  | ComponentContentPart;

export type MessageContent = string | ContentPart[];

export interface SSEChunk {
  event: string;
  data: string;
}

export interface Collection {
  id: string;
  namespace: string;
  name: string;
  is_public: boolean;
}

export interface FileInfo {
  id: string;
  namespace: string;
  name: string;
  content_type: string;
  current_version: number;
  visibility: string;
}
