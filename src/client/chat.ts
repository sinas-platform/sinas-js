import type { SinasClient } from './SinasClient';
import type {
  AnswerPendingInputOptions,
  ApprovalRequest,
  ApprovalResult,
  ApprovalResume,
  ApproveToolCallOptions,
  ChatCreateResult,
  ChatDetail,
  InvokeOptions,
  InvokeResult,
  MessageContent,
  MessageSendResult,
  PendingInput,
  PendingInputAnswerAccepted,
  PendingInputAnswerResult,
  SSEChunk,
  StreamDone,
  StreamFromChannelOptions,
  StreamOptions,
} from './types';
import {
  parseApproval,
  parseDone,
  parseMessage,
  parsePendingInputs,
  parseTurnState,
} from './chatEvents';

function splitAgentRef(agentRef: string): [string, string] {
  const [ns, name] = agentRef.split('/');
  if (!ns || !name) {
    throw new Error(`Invalid agent ref "${agentRef}": expected "namespace/name"`);
  }
  return [ns, name];
}

export async function createChat(
  client: SinasClient,
  agentRef: string,
  input?: Record<string, unknown>
): Promise<ChatCreateResult> {
  const [ns, name] = splitAgentRef(agentRef);
  const config = client.getConfig();
  const res = await client.fetch(`${config.apiBase}/agents/${ns}/${name}/chats`, {
    method: 'POST',
    body: JSON.stringify({ input: input || {} }),
  });
  const data = await res.json();
  return {
    id: data.id,
    agentNamespace: data.agent_namespace,
    agentName: data.agent_name,
    title: data.title,
  };
}

/**
 * Send a message and wait for the turn (non-streaming). On Sinas 0.5+ the
 * result says how the turn ended (`status`): with `input_required`, answer
 * the questions in `pendingInputs` with `answerPendingInput`.
 */
export async function sendMessage(
  client: SinasClient,
  chatId: string,
  content: MessageContent
): Promise<MessageSendResult> {
  const config = client.getConfig();
  const res = await client.fetch(`${config.apiBase}/chats/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
  const data = await res.json();
  return {
    id: data.id,
    chatId: data.chat_id,
    role: data.role,
    content: data.content,
    createdAt: data.created_at,
    ...parseTurnState(data),
  };
}

/**
 * Synchronous agent invoke: send a message, get the reply. Creates the chat
 * (or reuses the one for `sessionKey`). Check `status`: with
 * `input_required`, answer `pendingInputs` via `answerPendingInput`
 * (`{ wait: true }` returns the resumed turn's result the same way).
 */
export async function invokeAgent(
  client: SinasClient,
  agentRef: string,
  message: MessageContent,
  options: InvokeOptions = {},
): Promise<InvokeResult> {
  const [ns, name] = splitAgentRef(agentRef);
  const config = client.getConfig();
  const body: Record<string, unknown> = { message };
  if (options.sessionKey !== undefined) body.session_key = options.sessionKey;
  if (options.reset !== undefined) body.reset = options.reset;
  if (options.input !== undefined) body.input = options.input;
  const res = await client.fetch(`${config.apiBase}/agents/${ns}/${name}/invoke`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return {
    reply: typeof data.reply === 'string' ? data.reply : '',
    chatId: data.chat_id,
    sessionKey: data.session_key ?? null,
    ...parseTurnState(data),
  };
}

export async function getChat(
  client: SinasClient,
  chatId: string,
): Promise<ChatDetail> {
  const config = client.getConfig();
  const res = await client.fetch(`${config.apiBase}/chats/${chatId}`);
  const data = await res.json();
  const detail: ChatDetail = {
    id: data.id,
    agentNamespace: data.agent_namespace,
    agentName: data.agent_name,
    title: data.title,
    messages: (data.messages || []).map(parseMessage),
    pendingApprovals: (data.pending_approvals || [])
      .map(parseApproval)
      .filter((a: ApprovalRequest | null): a is ApprovalRequest => a !== null),
  };
  if (Array.isArray(data.pending_inputs)) {
    detail.pendingInputs = parsePendingInputs(data.pending_inputs);
  }
  return detail;
}

/**
 * Approve or reject a tool call that asked for approval. On Sinas 0.5+,
 * `resume` says whether the round resumes now (`queued`, follow `channelId`)
 * or waits for decisions on its other calls (`waiting`, nothing to stream);
 * `approvalResumeChannel(result, approved)` picks the channel to follow.
 */
export async function approveToolCall(
  client: SinasClient,
  chatId: string,
  toolCallId: string,
  approved: boolean,
  options: ApproveToolCallOptions = {},
): Promise<ApprovalResult> {
  const config = client.getConfig();
  const body: Record<string, unknown> = { approved };
  if (approved && options.alwaysAllow) body.always_allow = true;
  const res = await client.fetch(
    `${config.apiBase}/chats/${chatId}/approve-tool/${encodeURIComponent(toolCallId)}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  const data = await res.json();
  const result: ApprovalResult = {
    status: data.status,
    toolCallId: data.tool_call_id,
    channelId: data.channel_id,
  };
  if (data.resume === 'waiting' || data.resume === 'queued') result.resume = data.resume as ApprovalResume;
  if (typeof data.message === 'string') result.message = data.message;
  return result;
}

/** The ask_user questions the chat is suspended on (Sinas 0.5+). */
export async function listPendingInputs(
  client: SinasClient,
  chatId: string,
): Promise<PendingInput[]> {
  const config = client.getConfig();
  const res = await client.fetch(`${config.apiBase}/chats/${chatId}/pending-input`);
  return parsePendingInputs(await res.json());
}

/**
 * Answer an ask_user question; the answer becomes the call's tool result.
 * Without `wait`, resolves once the answer is recorded: follow
 * `answerResumeChannel(result)` (when not null) to stream the resumed turn.
 * With `{ wait: true }`, resolves with the resumed turn's result instead
 * (`input_required` again if the agent asks again).
 */
export function answerPendingInput(
  client: SinasClient,
  chatId: string,
  toolCallId: string,
  answer: string,
  options: AnswerPendingInputOptions & { wait: true },
): Promise<PendingInputAnswerResult>;
export function answerPendingInput(
  client: SinasClient,
  chatId: string,
  toolCallId: string,
  answer: string,
  options?: AnswerPendingInputOptions & { wait?: false },
): Promise<PendingInputAnswerAccepted>;
export function answerPendingInput(
  client: SinasClient,
  chatId: string,
  toolCallId: string,
  answer: string,
  options?: AnswerPendingInputOptions,
): Promise<PendingInputAnswerAccepted | PendingInputAnswerResult>;
export async function answerPendingInput(
  client: SinasClient,
  chatId: string,
  toolCallId: string,
  answer: string,
  options: AnswerPendingInputOptions = {},
): Promise<PendingInputAnswerAccepted | PendingInputAnswerResult> {
  const config = client.getConfig();
  const body: Record<string, unknown> = { answer };
  if (options.wait) body.wait = true;
  const res = await client.fetch(
    `${config.apiBase}/chats/${chatId}/pending-input/${encodeURIComponent(toolCallId)}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  const data = await res.json();
  if (options.wait) {
    return {
      toolCallId: data.tool_call_id,
      chatId: data.chat_id,
      reply: typeof data.reply === 'string' ? data.reply : '',
      message: data.message && typeof data.message === 'object' ? parseMessage(data.message) : null,
      ...parseTurnState(data),
    };
  }
  return {
    status: 'answered',
    toolCallId: data.tool_call_id,
    resumed: !!data.resumed,
    resumePending: !!data.resume_pending,
    channelId: data.channel_id ?? null,
    message: typeof data.message === 'string' ? data.message : '',
  };
}

/**
 * Follow a stream channel: the stream of a resumed round (after an approval
 * or an answer), an `in_progress` turn, or a reconnect.
 */
export function streamFromChannel(
  client: SinasClient,
  chatId: string,
  channelId: string,
  onChunk: (chunk: SSEChunk) => void,
  onDone?: (done: StreamDone) => void,
  onError?: (error: Error) => void,
  options: StreamFromChannelOptions = {},
): AbortController {
  const config = client.getConfig();
  const params = new URLSearchParams({ last_id: options.lastId ?? '0' });
  if (options.includeThinking) params.set('include_thinking', 'true');
  return runSSE(
    `${config.apiBase}/chats/${chatId}/stream/${encodeURIComponent(channelId)}?${params}`,
    (signal) => ({ headers: client.getAuthHeaders(), signal }),
    'Stream reconnect failed',
    onChunk,
    onDone,
    onError,
  );
}

/**
 * Open an SSE request and hand its events to `onChunk` until a `done`
 * event (or the end of the body), then call `onDone` once. Aborting the
 * returned controller ends it silently.
 */
function runSSE(
  url: string,
  init: (signal: AbortSignal) => RequestInit,
  failure: string,
  onChunk: (chunk: SSEChunk) => void,
  onDone?: (done: StreamDone) => void,
  onError?: (error: Error) => void,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(url, init(controller.signal));

      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(body.detail || failure);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { chunks, remaining } = parseSSE(buffer);
        buffer = remaining;

        for (const chunk of chunks) {
          onChunk(chunk);
          if (chunk.event === 'done') {
            onDone?.(parseDone(chunk.data));
            return;
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const { chunks } = parseSSE(buffer + '\n\n');
        for (const chunk of chunks) {
          onChunk(chunk);
          if (chunk.event === 'done') {
            onDone?.(parseDone(chunk.data));
            return;
          }
        }
      }

      onDone?.({ status: 'closed' });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      onError?.(err as Error);
    }
  })();

  return controller;
}

/**
 * Splits buffered SSE text into complete events (each ends with a blank
 * line); the incomplete tail is returned as `remaining` for the next read.
 */
export function parseSSE(buffer: string): { chunks: SSEChunk[]; remaining: string } {
  const chunks: SSEChunk[] = [];
  // Normalize \r\n to \n (sse_starlette uses \r\n line endings). A \r at
  // the very end stays in `remaining` until its \n arrives.
  const normalized = buffer.replace(/\r\n/g, '\n');
  let start = 0;
  let end: number;

  while ((end = normalized.indexOf('\n\n', start)) !== -1) {
    const block = normalized.slice(start, end);
    start = end + 2;
    let event = '';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (event || data.length) chunks.push({ event: event || 'message', data: data.join('\n') });
  }

  return { chunks, remaining: normalized.slice(start) };
}

/** Send a message and stream the turn as SSE events. */
export function streamMessage(
  client: SinasClient,
  chatId: string,
  content: MessageContent,
  onChunk: (chunk: SSEChunk) => void,
  onDone?: (done: StreamDone) => void,
  onError?: (error: Error) => void,
  options: StreamOptions = {},
): AbortController {
  const config = client.getConfig();
  const body: Record<string, unknown> = { content };
  if (options.includeThinking) body.include_thinking = true;
  return runSSE(
    `${config.apiBase}/chats/${chatId}/messages/stream`,
    (signal) => ({ method: 'POST', headers: client.getAuthHeaders(), body: JSON.stringify(body), signal }),
    'Stream request failed',
    onChunk,
    onDone,
    onError,
  );
}
