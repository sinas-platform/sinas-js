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

// ─── Auth ───

export type AuthMode = 'otp' | 'password' | 'password+otp';

export interface InfoResponse {
  auth_mode: AuthMode;
  version: string;
  features: Record<string, boolean>;
}

export interface LoginRequest {
  email: string;
  password?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  last_login_at: string | null;
  created_at: string;
  roles: string[];
}

export interface LoginResponse {
  message: string;
  /** Present when auth_mode includes "otp" — feed into verifyOTP. */
  session_id?: string;
  /** Present in password-only mode — login is complete. */
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  user?: AuthUser;
}

export interface OTPVerifyRequest {
  session_id: string;
  otp_code: string;
}

export interface OTPVerifyResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

export interface RefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface PermissionCheckRequest {
  permissions: string[];
  logic?: 'AND' | 'OR';
}

export interface PermissionCheckResult {
  permission: string;
  has_permission: boolean;
}

export interface PermissionCheckResponse {
  result: boolean;
  logic: string;
  checks: PermissionCheckResult[];
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
  /** Resolved status template description (e.g. "Searching weather in Madrid...") */
  description?: string;
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
  /**
   * The ask_user questions the chat is suspended on. Present when the
   * server reports them (Sinas 0.5+); undefined on older servers, which
   * have no ask_user.
   */
  pendingInputs?: PendingInput[];
}

export interface ApprovalRequest {
  type: string;
  toolCallId: string;
  functionNamespace: string;
  functionName: string;
  arguments: Record<string, unknown>;
}

/**
 * What happens to the round after an approval decision (Sinas 0.5+).
 * `waiting`: other calls of the same round still wait for a decision, so
 * nothing resumes yet and there is nothing to stream. `queued`: this was the
 * round's last decision; the round resumes on `channelId` (this includes a
 * final rejection, which the model gets as a rejection result).
 */
export type ApprovalResume = 'waiting' | 'queued';

export interface ApprovalResult {
  status: string;
  toolCallId: string;
  channelId: string;
  /** Undefined on servers before Sinas 0.5, which resume on every approval. */
  resume?: ApprovalResume;
  message?: string;
}

export interface ApproveToolCallOptions {
  /**
   * Approve this tool for the rest of the chat: later calls of the same tool
   * skip the ask. Only applies to an approval (ignored when rejecting).
   */
  alwaysAllow?: boolean;
}

// ─── Deferred turns: ask_user questions and turn status (Sinas 0.5+) ───

/** An ask_user question the conversation is suspended on. */
export interface PendingInput {
  toolCallId: string;
  question: string;
  /** Suggested answers, or null for a free-text question. */
  options: string[] | null;
  /** ISO timestamp after which the question expires (the round then resumes without it). */
  expiresAt: string | null;
  createdAt: string | null;
}

/**
 * How a synchronously answered turn ended.
 * - `completed`: the final reply is in the response.
 * - `input_required`: the agent asked the user; see `pendingInputs` and
 *   answer with `answerPendingInput`.
 * - `in_progress`: the turn goes on without this request; follow it on
 *   `channelId` (`streamFromChannel`) or read the chat later.
 * - `injected`: the chat was busy, so the message was delivered into the
 *   running (or parked) turn; nothing was answered by this request.
 */
export type TurnStatus = 'completed' | 'input_required' | 'in_progress' | 'injected';

/** LLM usage of one request (the reply plus its tool rounds). */
export interface TurnUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Null when calls were made but none could be priced. */
  costUsd: number | null;
  unpricedCalls: number;
  errors: number;
}

export interface TurnState {
  status: TurnStatus;
  pendingInputs: PendingInput[];
  /** Channel of the turn still going on (`in_progress`) or of the parked turn (`injected`). */
  channelId: string | null;
  /** Null when the server could not determine it (or predates Sinas 0.5). */
  usage: TurnUsage | null;
}

/** Result of a non-streaming `sendMessage`. The base fields are unchanged; the turn state is Sinas 0.5+. */
export interface MessageSendResult extends ChatMessage, TurnState {}

export interface InvokeOptions {
  /** Session key for conversation continuity across invokes. */
  sessionKey?: string;
  /** Archive the session's existing chat and start fresh. */
  reset?: boolean;
  /** Agent input variables (only used when a new chat is created). */
  input?: Record<string, unknown>;
}

export interface InvokeResult extends TurnState {
  /** The final reply (`completed`); what the agent said before asking or waiting otherwise; empty when `injected`. */
  reply: string;
  chatId: string;
  sessionKey: string | null;
}

export interface AnswerPendingInputOptions {
  /**
   * Wait for the resumed turn and return its result instead of a channel to
   * stream it from.
   */
  wait?: boolean;
}

/** The answer was recorded (HTTP 202, without `wait`). */
export interface PendingInputAnswerAccepted {
  status: 'answered';
  toolCallId: string;
  /** The answer was the round's last outstanding completion; its resume is queued. */
  resumed: boolean;
  /** The last completion, but the resume could not be queued yet; it is retried shortly. */
  resumePending: boolean;
  /** Where the resumed turn streams, when `resumed` or `resumePending`. */
  channelId: string | null;
  message: string;
}

/** The resumed turn's result (HTTP 200, with `wait: true`). */
export interface PendingInputAnswerResult extends TurnState {
  toolCallId: string;
  chatId: string;
  reply: string;
  /** The message `reply` comes from, when there is one. */
  message: ChatMessageFull | null;
}

export interface StreamOptions {
  /**
   * Stream the model's thinking text (Sinas 0.5+). Without it, a stream still
   * gets one empty `thinking` when the model starts thinking.
   */
  includeThinking?: boolean;
}

export interface StreamFromChannelOptions extends StreamOptions {
  /** Last received stream entry id to resume after (default "0": from the start). */
  lastId?: string;
}

/**
 * How a stream ended. `completed`: the turn finished. `suspended`: the turn
 * is parked waiting on the user (an ask_user question); the answer resumes it
 * on a new channel. `closed`: the connection ended without a `done` event.
 */
export interface StreamDone {
  status: 'completed' | 'suspended' | 'closed' | (string & {});
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
  file_data?: string;
  file_url?: string;
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

/** Data of an `input_required` stream event: the agent asked the user (ask_user). */
export interface InputRequiredEvent {
  type: 'input_required';
  tool_call_id: string;
  question: string;
  options?: string[] | null;
  expires_at?: string | null;
}

/**
 * Data of a `round_suspended` stream event: the tool round is parked on
 * deferred work (questions, background runs, sub-agents). It resumes on
 * `channel_id` when that work lands by itself.
 */
export interface RoundSuspendedEvent {
  type: 'round_suspended';
  tool_call_ids: string[];
  channel_id?: string | null;
  pending_completion_id?: string;
  usage?: Record<string, unknown> | null;
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

export interface FileUploadRequest {
  name: string;
  content_base64: string;
  content_type: string;
  visibility?: 'private' | 'shared';
  file_metadata?: Record<string, unknown>;
  update_existing?: boolean;
}

export interface FileUrlResult {
  url: string;
  filename: string;
  content_type: string;
  version: number;
  expires_in: number;
}
