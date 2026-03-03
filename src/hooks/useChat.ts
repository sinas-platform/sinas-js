import React from 'react';
import { createChat, getChat, streamMessage, approveToolCall, streamFromChannel } from '../client/chat';
import { useClient } from './context';
import type { ChatMessageFull, ApprovalRequest, SSEChunk, MessageContent } from '../client/types';

export interface ChatSessionMessage extends ChatMessageFull {
  /** True while streaming content is being appended */
  streaming?: boolean;
}

export interface UseChatResult {
  chatId: string | null;
  messages: ChatSessionMessage[];
  loading: boolean;
  streaming: boolean;
  error: string | null;
  pendingApprovals: ApprovalRequest[];
  send: (content: MessageContent) => void;
  approve: (toolCallId: string) => void;
  reject: (toolCallId: string) => void;
  stop: () => void;
  clearError: () => void;
}

export interface UseChatOptions {
  chatId?: string;
  input?: Record<string, unknown>;
}

export function useChat(
  agentRef: string,
  options?: UseChatOptions,
): UseChatResult {
  const client = useClient();

  const [chatId, setChatId] = React.useState<string | null>(options?.chatId ?? null);
  const [messages, setMessages] = React.useState<ChatSessionMessage[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = React.useState<ApprovalRequest[]>([]);

  const abortRef = React.useRef<AbortController | null>(null);
  const chatIdRef = React.useRef<string | null>(chatId);
  chatIdRef.current = chatId;

  // Load existing chat on mount if chatId provided
  React.useEffect(() => {
    if (!options?.chatId) return;
    let cancelled = false;

    setLoading(true);
    getChat(client, options.chatId)
      .then((detail) => {
        if (cancelled) return;
        setChatId(detail.id);
        setMessages(detail.messages);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [client, options?.chatId]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleStreamChunks = React.useCallback(
    (assistantId: string) => (chunk: SSEChunk) => {
      if (chunk.event === 'message') {
        try {
          const parsed = JSON.parse(chunk.data);
          if (parsed.content) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: (m.content || '') + parsed.content }
                  : m,
              ),
            );
          }
        } catch {
          // Non-JSON content chunk — append raw data
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: (m.content || '') + chunk.data }
                : m,
            ),
          );
        }
      } else if (chunk.event === 'approval_required') {
        try {
          const parsed = JSON.parse(chunk.data) as ApprovalRequest;
          setPendingApprovals((prev) => [...prev, parsed]);
        } catch {
          // ignore malformed approval events
        }
      } else if (chunk.event === 'error') {
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

  const refreshMessages = React.useCallback(
    async (id: string) => {
      try {
        const detail = await getChat(client, id);
        setMessages(detail.messages);
      } catch {
        // Refresh is best-effort — streaming content already visible
      }
    },
    [client],
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
        setStreaming(true);
        setError(null);
        setPendingApprovals([]);

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

        // Add empty assistant message to accumulate streaming content
        const assistantId = `tmp-assistant-${Date.now()}`;
        const assistantMsg: ChatSessionMessage = {
          id: assistantId,
          chatId: activeChatId,
          role: 'assistant',
          content: '',
          toolCalls: null,
          toolCallId: null,
          name: null,
          createdAt: new Date().toISOString(),
          streaming: true,
        };
        setMessages((prev) => [...prev, assistantMsg]);

        const controller = streamMessage(
          client,
          activeChatId,
          content,
          handleStreamChunks(assistantId),
          () => {
            setStreaming(false);
            // Refresh to get authoritative server state (tool calls, tool responses)
            refreshMessages(activeChatId!);
          },
          (err: Error) => {
            setError(err.message);
            setStreaming(false);
          },
        );

        abortRef.current = controller;
      };

      doSend();
    },
    [client, agentRef, options?.input, handleStreamChunks, refreshMessages],
  );

  const handleApproval = React.useCallback(
    (toolCallId: string, approved: boolean) => {
      const currentChatId = chatIdRef.current;
      if (!currentChatId) return;

      setPendingApprovals((prev) => prev.filter((a) => a.toolCallId !== toolCallId));
      setStreaming(true);
      setError(null);

      // Add placeholder assistant message for the resumed stream
      const assistantId = `tmp-resume-${Date.now()}`;
      if (approved) {
        const assistantMsg: ChatSessionMessage = {
          id: assistantId,
          chatId: currentChatId,
          role: 'assistant',
          content: '',
          toolCalls: null,
          toolCallId: null,
          name: null,
          createdAt: new Date().toISOString(),
          streaming: true,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }

      (async () => {
        try {
          const result = await approveToolCall(client, currentChatId, toolCallId, approved);

          if (!approved) {
            setStreaming(false);
            refreshMessages(currentChatId);
            return;
          }

          // Connect to resume stream
          const controller = streamFromChannel(
            client,
            currentChatId,
            result.channelId,
            handleStreamChunks(assistantId),
            () => {
              setStreaming(false);
              refreshMessages(currentChatId);
            },
            (err: Error) => {
              setError(err.message);
              setStreaming(false);
            },
          );

          abortRef.current = controller;
        } catch (e) {
          setError((e as Error).message);
          setStreaming(false);
        }
      })();
    },
    [client, handleStreamChunks, refreshMessages],
  );

  const approve = React.useCallback(
    (toolCallId: string) => handleApproval(toolCallId, true),
    [handleApproval],
  );

  const reject = React.useCallback(
    (toolCallId: string) => handleApproval(toolCallId, false),
    [handleApproval],
  );

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
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
    send,
    approve,
    reject,
    stop,
    clearError,
  };
}
