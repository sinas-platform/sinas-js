import React from 'react';
import {
  answerPendingInput,
  approveToolCall,
  createChat,
  getChat,
  streamFromChannel,
  streamMessage,
} from '../client/chat';
import {
  answerResumeChannel,
  approvalResumeChannel,
  parseApproval,
  pendingInputFromChunk,
} from '../client/chatEvents';
import { useClient } from './context';
import {
  NOT_THINKING,
  TRAILING_POLLS_MS,
  addApproval,
  applyTextDelta,
  applyThinking,
  applyToolEnd,
  applyToolStart,
  createLatestGate,
  mergePendingInputs,
  nextPendingPollMs,
  parseMessageChunk,
  stopThinking,
  thinkingView,
  type ThinkingRounds,
} from './chatState';
import type {
  ChatMessageFull,
  ApprovalRequest,
  SSEChunk,
  MessageContent,
  PendingInput,
  StreamDone,
} from '../client/types';

export interface ToolResult {
  content: string;
  name: string;
}

export interface ChatSessionMessage extends ChatMessageFull {
  /** True while streaming content is being appended */
  streaming?: boolean;
  /** Inline tool results keyed by tool_call_id (merged from tool_end events) */
  toolResults?: Record<string, ToolResult>;
}

export interface ToolStatus {
  toolCallId: string;
  name: string;
  description: string;
  status: 'running' | 'complete';
}

/**
 * The model's thinking during the current turn. Thinking isn't stored with
 * the messages, so it is only known while (and after) streaming the turn;
 * it resets when the next turn starts.
 */
export interface ChatThinking {
  /** The model is thinking right now (before its answer or next tool call). */
  active: boolean;
  /**
   * The thinking text so far this turn; only sent with `includeThinking`
   * (otherwise always ''). Thinking rounds are separated by a blank line.
   */
  text: string;
}

export interface ApproveOptions {
  /** Approve this tool for the rest of the chat: it won't ask again (Sinas 0.5+). */
  alwaysAllow?: boolean;
}

export interface FollowOptions {
  /** Last received stream entry id to resume after (default: from the start). */
  lastId?: string;
}

export interface UseChatResult {
  chatId: string | null;
  messages: ChatSessionMessage[];
  loading: boolean;
  streaming: boolean;
  error: string | null;
  pendingApprovals: ApprovalRequest[];
  /**
   * The ask_user questions the conversation waits on (Sinas 0.5+): from
   * `input_required` stream events and from the chat as loaded. Answer with
   * `answer`.
   */
  pendingInputs: PendingInput[];
  /** The model's thinking in the current turn (see `includeThinking`). */
  thinking: ChatThinking;
  toolStatus: ToolStatus[];
  send: (content: MessageContent) => void;
  /**
   * Approve a tool call. When other calls of the same round still wait for a
   * decision, nothing streams until the last one is decided.
   */
  approve: (toolCallId: string, options?: ApproveOptions) => void;
  reject: (toolCallId: string) => void;
  /**
   * Answer an ask_user question. Resolves true once the answer is recorded
   * (the question is then removed from `pendingInputs`), false when it
   * failed (see `error`). When it was the round's last open question, the
   * resumed turn streams into `messages`.
   */
  answer: (toolCallId: string, answer: string) => Promise<boolean>;
  /**
   * Stream a channel into this session: a turn that goes on elsewhere (an
   * `in_progress` result, a reconnect to a running turn).
   */
  follow: (channelId: string, options?: FollowOptions) => void;
  stop: () => void;
  clearError: () => void;
}

export interface UseChatOptions {
  chatId?: string;
  input?: Record<string, unknown>;
  /**
   * Stream the model's thinking text into `thinking.text` (Sinas 0.5+).
   * Without it, `thinking.active` still says when the model is thinking.
   */
  includeThinking?: boolean;
  /**
   * While questions wait with no stream open, re-read the chat periodically
   * and just after the earliest deadline, so an expired question (the round
   * then resumes server-side) or one answered elsewhere shows up without a
   * reload. Default true.
   */
  pollPendingInputs?: boolean;
}

export function useChat(
  agentRef: string,
  options?: UseChatOptions,
): UseChatResult {
  const client = useClient();
  const includeThinking = !!options?.includeThinking;
  const pollPendingInputs = options?.pollPendingInputs !== false;

  const [chatId, setChatId] = React.useState<string | null>(options?.chatId ?? null);
  const [messages, setMessages] = React.useState<ChatSessionMessage[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = React.useState<ApprovalRequest[]>([]);
  const [pendingInputs, setPendingInputs] = React.useState<PendingInput[]>([]);
  const [thinking, setThinking] = React.useState<ThinkingRounds>(NOT_THINKING);
  const thinkingShown = React.useMemo(() => thinkingView(thinking), [thinking]);
  const [toolStatus, setToolStatus] = React.useState<ToolStatus[]>([]);
  // Index into TRAILING_POLLS_MS while re-reading a chat whose question went
  // away server-side; its length means "not trailing".
  const [trailingPoll, setTrailingPoll] = React.useState(TRAILING_POLLS_MS.length);
  // Bumped after each poll so the next one is scheduled even when the poll's
  // refresh was superseded (and so changed nothing).
  const [pollTick, setPollTick] = React.useState(0);

  const abortRef = React.useRef<AbortController | null>(null);
  const chatIdRef = React.useRef<string | null>(chatId);
  chatIdRef.current = chatId;
  // Only the newest refresh (or turn) may write the server's state.
  const [gate] = React.useState(createLatestGate);

  /**
   * Re-read the server's state: messages, approvals, questions. Resolves to
   * the questions shown, or null when the read failed or a newer refresh or
   * turn superseded it (its result is then dropped).
   */
  const refresh = React.useCallback(
    async (id: string): Promise<PendingInput[] | null> => {
      const ticket = gate.next();
      try {
        const detail = await getChat(client, id);
        if (!gate.isCurrent(ticket)) return null;
        setMessages(detail.messages);
        setPendingApprovals(detail.pendingApprovals ?? []);
        const inputs = detail.pendingInputs ?? [];
        setPendingInputs(inputs);
        return inputs;
      } catch {
        // Best-effort: what is already shown stays when the read fails.
        return null;
      }
    },
    [client, gate],
  );

  // Load existing chat on mount if chatId provided
  React.useEffect(() => {
    if (!options?.chatId) return;
    let cancelled = false;
    const ticket = gate.next();

    setLoading(true);
    getChat(client, options.chatId)
      .then((detail) => {
        if (cancelled || !gate.isCurrent(ticket)) return;
        setChatId(detail.id);
        setMessages(detail.messages);
        setPendingApprovals(detail.pendingApprovals ?? []);
        setPendingInputs(detail.pendingInputs ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [client, gate, options?.chatId]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // While questions wait with no stream open, nothing announces that one
  // expired (the round then resumes server-side) or was answered elsewhere:
  // re-read the chat periodically and just after the earliest deadline,
  // then a few more times once a question went away, to show the reply.
  React.useEffect(() => {
    if (!pollPendingInputs || streaming || !chatId) return;
    let delay: number | null = null;
    if (pendingInputs.length > 0) delay = nextPendingPollMs(pendingInputs, Date.now());
    else if (trailingPoll < TRAILING_POLLS_MS.length) delay = TRAILING_POLLS_MS[trailingPoll];
    if (delay === null) return;
    const waiting = pendingInputs.map((p) => p.toolCallId);
    const timer = setTimeout(async () => {
      const now = await refresh(chatId);
      if (waiting.length === 0) setTrailingPoll((i) => i + 1);
      else if (now && waiting.some((id) => !now.some((p) => p.toolCallId === id))) setTrailingPoll(0);
      setPollTick((t) => t + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [pollPendingInputs, chatId, streaming, pendingInputs, trailingPoll, pollTick, refresh]);

  const handleStreamChunk = React.useCallback(
    (chunk: SSEChunk) => {
      // A question: its own event, or (some earlier backends, inline turn)
      // a typed message event.
      const asked = pendingInputFromChunk(chunk);
      if (asked) {
        setThinking(stopThinking);
        setPendingInputs((prev) => mergePendingInputs(prev, [asked]));
        return;
      }
      const chatIdNow = chatIdRef.current || '';
      if (chunk.event === 'message') {
        const { text, thinking: thought } = parseMessageChunk(chunk.data);
        if (thought !== undefined) setThinking((prev) => applyThinking(prev, thought));
        if (text) {
          setThinking(stopThinking);
          setMessages((prev) => applyTextDelta(prev, text, chatIdNow));
        }
      } else if (chunk.event === 'tool_start') {
        setThinking(stopThinking);
        try {
          const parsed = JSON.parse(chunk.data);
          setToolStatus((prev) => [
            ...prev,
            { toolCallId: parsed.tool_call_id, name: parsed.name, description: parsed.description, status: 'running' },
          ]);
          setMessages((prev) => applyToolStart(prev, parsed, chatIdNow));
        } catch {
          // ignore malformed tool_start events
        }
      } else if (chunk.event === 'tool_end') {
        try {
          const parsed = JSON.parse(chunk.data);
          setToolStatus((prev) =>
            prev.map((t) => (t.toolCallId === parsed.tool_call_id ? { ...t, status: 'complete' } : t)),
          );
          setMessages((prev) => applyToolEnd(prev, parsed));
        } catch {
          // ignore malformed tool_end events
        }
      } else if (chunk.event === 'approval_required') {
        setThinking(stopThinking);
        try {
          const approval = parseApproval(JSON.parse(chunk.data));
          if (approval) setPendingApprovals((prev) => addApproval(prev, approval));
        } catch {
          // ignore malformed approval events
        }
      } else if (chunk.event === 'error') {
        setThinking(stopThinking);
        try {
          const parsed = JSON.parse(chunk.data);
          setError(parsed.error || 'Stream error');
        } catch {
          setError(chunk.data || 'Stream error');
        }
      }
    },
    [],
  );

  const streamCallbacks = React.useCallback(
    (id: string) =>
      [
        (_done: StreamDone) => {
          setStreaming(false);
          setToolStatus([]);
          setThinking(stopThinking);
          // Re-read the authoritative server state (and, after a suspended
          // turn, the questions it waits on).
          refresh(id);
        },
        (err: Error) => {
          setError(err.message);
          setStreaming(false);
          setToolStatus([]);
          setThinking(stopThinking);
        },
      ] as const,
    [refresh],
  );

  // Stream a channel (a resumed round after an approval or an answer).
  const followChannel = React.useCallback(
    (id: string, channelId: string, lastId?: string) => {
      abortRef.current?.abort();
      gate.next(); // a refresh still in flight is older than this stream
      setStreaming(true);
      setError(null);
      setThinking(NOT_THINKING);
      const [onDone, onError] = streamCallbacks(id);
      abortRef.current = streamFromChannel(client, id, channelId, handleStreamChunk, onDone, onError, {
        includeThinking,
        lastId,
      });
    },
    [client, gate, includeThinking, handleStreamChunk, streamCallbacks],
  );

  const send = React.useCallback(
    (content: MessageContent) => {
      const doSend = async () => {
        let activeChatId = chatIdRef.current;

        // Auto-create chat on first send
        if (!activeChatId) {
          setLoading(true);
          setError(null);
          try {
            const result = await createChat(client, agentRef, options?.input);
            activeChatId = result.id;
            setChatId(result.id);
            chatIdRef.current = result.id;
          } catch (e) {
            setError((e as Error).message);
            setLoading(false);
            return;
          }
          setLoading(false);
        }

        abortRef.current?.abort();
        gate.next(); // a refresh still in flight is older than this turn
        setStreaming(true);
        setError(null);
        setPendingApprovals([]);
        setToolStatus([]);
        setThinking(NOT_THINKING);

        // Add user message optimistically
        const displayContent = typeof content === 'string' ? content : JSON.stringify(content);
        const userMsg: ChatSessionMessage = {
          id: `tmp-user-${Date.now()}`,
          chatId: activeChatId,
          role: 'user',
          content: displayContent,
          toolCalls: null,
          toolCallId: null,
          name: null,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg]);

        const [onDone, onError] = streamCallbacks(activeChatId);
        abortRef.current = streamMessage(client, activeChatId, content, handleStreamChunk, onDone, onError, {
          includeThinking,
        });
      };

      doSend();
    },
    [client, agentRef, options?.input, gate, includeThinking, handleStreamChunk, streamCallbacks],
  );

  const decide = React.useCallback(
    (toolCallId: string, approved: boolean, alwaysAllow: boolean) => {
      const id = chatIdRef.current;
      if (!id) return;
      gate.next(); // a refresh in flight must not bring the card back
      setPendingApprovals((prev) => prev.filter((a) => a.toolCallId !== toolCallId));
      setError(null);

      (async () => {
        try {
          const result = await approveToolCall(client, id, toolCallId, approved, { alwaysAllow });
          // Until the round's last decision there is nothing to stream: the
          // remaining approvals stay pending.
          const channelId = approvalResumeChannel(result, approved);
          if (channelId) followChannel(id, channelId);
          else if (result.resume === undefined) refresh(id); // pre-0.5 rejection
        } catch (e) {
          setError((e as Error).message);
          // Show what is actually still pending (expired, already decided…)
          refresh(id);
        }
      })();
    },
    [client, gate, followChannel, refresh],
  );

  const approve = React.useCallback(
    (toolCallId: string, opts?: ApproveOptions) => decide(toolCallId, true, !!opts?.alwaysAllow),
    [decide],
  );

  const reject = React.useCallback(
    (toolCallId: string) => decide(toolCallId, false, false),
    [decide],
  );

  const answer = React.useCallback(
    async (toolCallId: string, text: string): Promise<boolean> => {
      const id = chatIdRef.current;
      if (!id) return false;
      setError(null);
      try {
        const result = await answerPendingInput(client, id, toolCallId, text);
        gate.next(); // a refresh in flight must not bring the question back
        setPendingInputs((prev) => prev.filter((p) => p.toolCallId !== toolCallId));
        // The last outstanding completion resumes the round on a fresh
        // channel; otherwise the round keeps waiting on the others.
        const channelId = answerResumeChannel(result);
        if (channelId) followChannel(id, channelId);
        return true;
      } catch (e) {
        setError((e as Error).message);
        refresh(id);
        return false;
      }
    },
    [client, gate, followChannel, refresh],
  );

  const follow = React.useCallback(
    (channelId: string, opts?: FollowOptions) => {
      const id = chatIdRef.current;
      if (!id) return;
      followChannel(id, channelId, opts?.lastId);
    },
    [followChannel],
  );

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setThinking(stopThinking);
  }, []);

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  return {
    chatId,
    messages,
    loading,
    streaming,
    error,
    pendingApprovals,
    pendingInputs,
    thinking: thinkingShown,
    toolStatus,
    send,
    approve,
    reject,
    answer,
    follow,
    stop,
    clearError,
  };
}
