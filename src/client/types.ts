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
    stateNamespacesReadonly: string[];
    stateNamespacesReadwrite: string[];
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

export interface SSEChunk {
  event: string;
  data: string;
}
