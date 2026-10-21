// Pure parsers for chat API payloads and stream events (no I/O), shared by
// the client functions in chat.ts and the useChat hook.
import type {
  ApprovalRequest,
  ChatMessageFull,
  PendingInput,
  SSEChunk,
  StreamDone,
  TurnState,
  TurnStatus,
  TurnUsage,
} from './types';

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const optionsOf = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.every((o) => typeof o === 'string') ? (v as string[]) : null;

/**
 * One ask_user question from the API (`GET /chats/{id}/pending-input`, the
 * chat detail, a turn result, or an `input_required` stream event), or null
 * when the value isn't one.
 */
export function parsePendingInput(raw: unknown): PendingInput | null {
  if (!isObject(raw)) return null;
  if (typeof raw.tool_call_id !== 'string' || !raw.tool_call_id) return null;
  return {
    toolCallId: raw.tool_call_id,
    question: str(raw.question) ?? '',
    options: optionsOf(raw.options),
    expiresAt: str(raw.expires_at),
    createdAt: str(raw.created_at),
  };
}

export function parsePendingInputs(raw: unknown): PendingInput[] {
  return Array.isArray(raw) ? raw.map(parsePendingInput).filter((p): p is PendingInput => p !== null) : [];
}

/**
 * The question an SSE chunk announces, or null. Streams send it as its own
 * `input_required` event; some earlier backends sent an inline turn's as a
 * `message` event whose data has `type: "input_required"`. Both are handled.
 */
export function pendingInputFromChunk(chunk: SSEChunk): PendingInput | null {
  if (chunk.event !== 'input_required' && chunk.event !== 'message') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(chunk.data);
  } catch {
    return null;
  }
  if (chunk.event === 'message' && (!isObject(parsed) || parsed.type !== 'input_required')) return null;
  return parsePendingInput(parsed);
}

/** An approval as the API reports it (stream event or chat detail), or null when malformed. */
export function parseApproval(raw: unknown): ApprovalRequest | null {
  if (!isObject(raw) || typeof raw.tool_call_id !== 'string') return null;
  return {
    type: str(raw.type) ?? 'approval_required',
    toolCallId: raw.tool_call_id,
    functionNamespace: str(raw.function_namespace) ?? '',
    functionName: str(raw.function_name) ?? '',
    arguments: isObject(raw.arguments) ? raw.arguments : {},
  };
}

export function parseUsage(raw: unknown): TurnUsage | null {
  if (!isObject(raw)) return null;
  return {
    calls: num(raw.calls),
    promptTokens: num(raw.prompt_tokens),
    completionTokens: num(raw.completion_tokens),
    totalTokens: num(raw.total_tokens),
    cacheReadTokens: num(raw.cache_read_tokens),
    cacheWriteTokens: num(raw.cache_write_tokens),
    costUsd: typeof raw.cost_usd === 'number' ? raw.cost_usd : null,
    unpricedCalls: num(raw.unpriced_calls),
    errors: num(raw.errors),
  };
}

const TURN_STATUSES: readonly TurnStatus[] = ['completed', 'input_required', 'in_progress', 'injected'];

/** The turn-state fields of a send / invoke / answer response; servers before 0.5 omit them. */
export function parseTurnState(raw: Raw): TurnState {
  const status = TURN_STATUSES.includes(raw.status as TurnStatus) ? (raw.status as TurnStatus) : 'completed';
  return {
    status,
    pendingInputs: parsePendingInputs(raw.pending_inputs),
    channelId: str(raw.channel_id),
    usage: parseUsage(raw.usage),
  };
}

export function parseMessage(data: Raw): ChatMessageFull {
  const toolCalls = data.tool_calls as ChatMessageFull['toolCalls'] | undefined;
  return {
    id: data.id as string,
    chatId: data.chat_id as string,
    role: data.role as ChatMessageFull['role'],
    content: (data.content as string) ?? null,
    toolCalls: toolCalls ?? null,
    toolCallId: (data.tool_call_id as string) ?? null,
    name: (data.name as string) ?? null,
    createdAt: data.created_at as string,
  };
}

/** How a `done` event ended the stream. */
export function parseDone(data: string): StreamDone {
  try {
    const parsed = JSON.parse(data);
    if (isObject(parsed) && typeof parsed.status === 'string') return { status: parsed.status };
  } catch {
    // fall through
  }
  return { status: 'completed' };
}

/**
 * The channel to follow after an approval decision, or null when there is
 * nothing to stream yet. A round with several asked calls resumes once,
 * after its last decision; until then the response says `resume: "waiting"`.
 * On servers before 0.5 (no `resume` field) only an approval resumed.
 */
export function approvalResumeChannel(
  result: { resume?: string | null; channelId?: string | null },
  approved = true,
): string | null {
  if (result.resume === 'waiting') return null;
  if (result.resume === undefined && !approved) return null;
  return result.channelId || null;
}

/**
 * The channel to follow after answering a question (202 response), or null.
 * The answer resumes the conversation only when it was the round's last
 * outstanding completion (`resumed`) or that resume is being retried
 * (`resumePending`).
 */
export function answerResumeChannel(result: {
  resumed?: boolean;
  resumePending?: boolean;
  channelId?: string | null;
}): string | null {
  if (!result.resumed && !result.resumePending) return null;
  return result.channelId || null;
}
