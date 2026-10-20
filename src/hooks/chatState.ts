// useChat's state transitions as pure functions, so they can be tested
// without React (tests/chat-state.test.mjs). The hook only wires them to
// state.
import type { ApprovalRequest, PendingInput } from '../client/types';
import type { ChatSessionMessage, ChatThinking } from './useChat';

/** What a `message` stream event carries: answer text and/or thinking. */
export interface MessageChunk {
  /** Answer text ('' when the event carries none, e.g. a typed event such as tool_rejected). */
  text: string;
  /** Thinking text: '' for "the model started thinking", undefined when not a thinking event. */
  thinking?: string;
}

export function parseMessageChunk(data: string): MessageChunk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { text: data };
  }
  if (!parsed || typeof parsed !== 'object') return { text: '' };
  const p = parsed as Record<string, unknown>;
  const out: MessageChunk = { text: typeof p.content === 'string' ? p.content : '' };
  if (typeof p.thinking === 'string') out.thinking = p.thinking;
  return out;
}

/** Appends streamed text to the assistant message being streamed, or starts one. */
export function applyTextDelta(
  messages: ChatSessionMessage[],
  text: string,
  chatId: string,
  now: Date = new Date(),
): ChatSessionMessage[] {
  if (!text) return messages;
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant' && !last.toolCalls && last.streaming) {
    const next = [...messages];
    next[next.length - 1] = { ...last, content: (last.content || '') + text };
    return next;
  }
  return [
    ...messages,
    {
      id: `tmp-text-${now.getTime()}`,
      chatId,
      role: 'assistant',
      content: text,
      toolCalls: null,
      toolCallId: null,
      name: null,
      createdAt: now.toISOString(),
      streaming: true,
    },
  ];
}

export interface ToolStartEvent {
  tool_call_id: string;
  name: string;
  arguments?: string;
  description?: string;
}

/** Shows a started tool call as its own bubble (once), freezing the text before it. */
export function applyToolStart(
  messages: ChatSessionMessage[],
  event: ToolStartEvent,
  chatId: string,
  now: Date = new Date(),
): ChatSessionMessage[] {
  if (messages.some((m) => m.toolCalls?.some((tc) => tc.id === event.tool_call_id))) return messages;
  const frozen = messages.map((m, i) =>
    i === messages.length - 1 && m.streaming && m.role === 'assistant' && !m.toolCalls ? { ...m, streaming: false } : m,
  );
  return [
    ...frozen,
    {
      id: `tmp-tc-${event.tool_call_id}`,
      chatId,
      role: 'assistant',
      content: null,
      toolCalls: [
        {
          id: event.tool_call_id,
          type: 'function',
          function: { name: event.name, arguments: event.arguments || '{}' },
          description: event.description,
        },
      ],
      toolCallId: null,
      name: null,
      createdAt: now.toISOString(),
      streaming: true,
    },
  ];
}

/** Merges a finished tool call's result into its bubble. */
export function applyToolEnd(
  messages: ChatSessionMessage[],
  event: { tool_call_id: string; name: string; result?: unknown },
): ChatSessionMessage[] {
  if (event.result === undefined) return messages;
  const content = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
  return messages.map((m) =>
    m.toolCalls?.some((tc) => tc.id === event.tool_call_id)
      ? { ...m, toolResults: { ...m.toolResults, [event.tool_call_id]: { content, name: event.name } } }
      : m,
  );
}

/** Adds an approval card unless that call already has one. */
export function addApproval(current: ApprovalRequest[], approval: ApprovalRequest): ApprovalRequest[] {
  return current.some((a) => a.toolCallId === approval.toolCallId) ? current : [...current, approval];
}

/** Adds questions not already listed (by tool call id), keeping order. */
export function mergePendingInputs(current: PendingInput[], incoming: PendingInput[]): PendingInput[] {
  const seen = new Set(current.map((p) => p.toolCallId));
  const added = incoming.filter((p) => !seen.has(p.toolCallId) && seen.add(p.toolCallId));
  return added.length ? [...current, ...added] : current;
}

/** The hook's thinking state: one entry per thinking round of the turn. */
export interface ThinkingRounds {
  active: boolean;
  rounds: string[];
}

export const NOT_THINKING: ThinkingRounds = { active: false, rounds: [] };

/**
 * A thinking chunk: the model is thinking. The first chunk after the answer
 * or a tool call started (often an empty "started thinking") opens a new
 * round.
 */
export function applyThinking(state: ThinkingRounds, thinking: string): ThinkingRounds {
  if (!state.active) return { active: true, rounds: [...state.rounds, thinking] };
  if (!thinking) return state;
  const rounds = [...state.rounds];
  rounds[rounds.length - 1] += thinking;
  return { active: true, rounds };
}

/** The answer, a tool call or the end of the stream: thinking has stopped. */
export function stopThinking(state: ThinkingRounds): ThinkingRounds {
  return state.active ? { ...state, active: false } : state;
}

/** What the hook returns: the rounds' text, separated by a blank line. */
export function thinkingView(state: ThinkingRounds): ChatThinking {
  return { active: state.active, text: state.rounds.filter((r) => r).join('\n\n') };
}

/**
 * Orders asynchronous refreshes: each one takes a ticket, and only the
 * newest ticket may write its result. A slow refresh from an earlier turn
 * then can't overwrite what a later turn (or a later refresh) showed.
 * Starting a turn also takes a ticket, voiding refreshes still in flight.
 */
export function createLatestGate() {
  let latest = 0;
  return {
    next: (): number => ++latest,
    isCurrent: (ticket: number): boolean => ticket === latest,
  };
}

/** Never wait longer than this between checks while a question is open. */
export const PENDING_POLL_MAX_MS = 30_000;
const PENDING_POLL_MIN_MS = 1_000;
/** Checked this long after a deadline (the server's expiry sweep runs about once a minute). */
const EXPIRY_GRACE_MS = 5_000;
/** Once a deadline has passed, how often to check until the sweep has run. */
const OVERDUE_POLL_MS = 10_000;

/**
 * How long to wait before re-reading a chat that waits on ask_user
 * questions with no stream open. An unanswered question expires and the
 * round resumes server-side without the client being told; re-reading
 * every PENDING_POLL_MAX_MS, and just after the earliest deadline, shows
 * that (and an answer given elsewhere) without a reload.
 */
export function nextPendingPollMs(inputs: PendingInput[], nowMs: number): number {
  let wait = PENDING_POLL_MAX_MS;
  for (const input of inputs) {
    const deadline = input.expiresAt ? Date.parse(input.expiresAt) : NaN;
    if (Number.isNaN(deadline)) continue;
    const untilDue = deadline + EXPIRY_GRACE_MS - nowMs;
    wait = Math.min(wait, untilDue > 0 ? untilDue : OVERDUE_POLL_MS);
  }
  return Math.max(PENDING_POLL_MIN_MS, wait);
}

/**
 * After a question disappears without an answer from this hook (it expired,
 * or was answered elsewhere), the round resumes server-side: re-read the
 * chat at these delays to show the reply.
 */
export const TRAILING_POLLS_MS = [5_000, 15_000, 30_000];
