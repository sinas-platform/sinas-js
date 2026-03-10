import React from 'react';
import { createChat, getChat, streamMessage, approveToolCall, streamFromChannel } from '../client/chat';
import { useClient } from './context';
import type { ChatMessageFull, ApprovalRequest, SSEChunk, MessageContent } from '../client/types';

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

export interface UseChatResult {
  chatId: string | null;
  messages: ChatSessionMessage[];
  loading: boolean;
  streaming: boolean;
  error: string | null;
  pendingApprovals: ApprovalRequest[];
  toolStatus: ToolStatus[];
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
  const [toolStatus, setToolStatus] = React.useState<ToolStatus[]>([]);

  const abortRef = React.useRef<AbortController | null>(null);
  const chatIdRef = React.useRef<string | null>(chatId);
  chatIdRef.current = chatId;
  const activeAssistantIdRef = React.useRef<string>('');
  const activeToolCallMsgIdRef = React.useRef<string>('');

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
        if (detail.pendingApprovals?.length) {
          setPendingApprovals(detail.pendingApprovals);
        }
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
    (chunk: SSEChunk) => {
      if (chunk.event === 'message') {
        try {
          const parsed = JSON.parse(chunk.data);
          if (parsed.content) {
            const targetId = activeAssistantIdRef.current;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId
                  ? { ...m, content: (m.content || '') + parsed.content }
                  : m,
              ),
            );
          }
        } catch {
          // Non-JSON content chunk — append raw data
          const targetId = activeAssistantIdRef.current;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === targetId
                ? { ...m, content: (m.content || '') + chunk.data }
                : m,
            ),
          );
        }
      } else if (chunk.event === 'tool_start') {
        try {
          const parsed = JSON.parse(chunk.data);
          setToolStatus((prev) => [
            ...prev,
            { toolCallId: parsed.tool_call_id, name: parsed.name, description: parsed.description, status: 'running' },
          ]);
          // Insert tool call message before the streaming placeholder so
          // the "Thinking..." / status text stays at the bottom during execution.
          const placeholderId = activeAssistantIdRef.current;
          const toolCallMsg: ChatSessionMessage = {
            id: `tmp-tc-${parsed.tool_call_id}`,
            chatId: chatIdRef.current || '',
            role: 'assistant',
            content: null,
            toolCalls: [{
              id: parsed.tool_call_id,
              type: 'function',
              function: { name: parsed.name, arguments: parsed.arguments || '{}' },
              description: parsed.description,
            }],
            toolCallId: null,
            name: null,
            createdAt: new Date().toISOString(),
            streaming: true,
          };
          setMessages((prev) => {
            // Skip if a message for this tool call already exists (e.g. after approval
            // refresh replaced tmp IDs with server IDs, but tool call content is the same)
            const alreadyExists = prev.some((m) =>
              m.toolCalls?.some((tc) => tc.id === parsed.tool_call_id),
            );
            if (alreadyExists) return prev;
            const idx = prev.findIndex((m) => m.id === placeholderId);
            if (idx >= 0) {
              const next = [...prev];
              next.splice(idx, 0, toolCallMsg);
              return next;
            }
            return [...prev, toolCallMsg];
          });
        } catch {
          // ignore malformed tool_start events
        }
      } else if (chunk.event === 'tool_end') {
        try {
          const parsed = JSON.parse(chunk.data);
          setToolStatus((prev) =>
            prev.map((t) => t.toolCallId === parsed.tool_call_id ? { ...t, status: 'complete' } : t),
          );
          // Merge result into the existing tool call message (same bubble)
          if (parsed.result !== undefined) {
            const resultContent = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
            setMessages((prev) =>
              prev.map((m) => {
                if (m.toolCalls?.some((tc) => tc.id === parsed.tool_call_id)) {
                  return {
                    ...m,
                    toolResults: {
                      ...m.toolResults,
                      [parsed.tool_call_id]: { content: resultContent, name: parsed.name },
                    },
                  };
                }
                return m;
              }),
            );
          }
        } catch {
          // ignore malformed tool_end events
        }
      } else if (chunk.event === 'approval_required') {
        try {
          const raw = JSON.parse(chunk.data);
          const parsed: ApprovalRequest = {
            type: raw.type,
            toolCallId: raw.tool_call_id,
            functionNamespace: raw.function_namespace,
            functionName: raw.function_name,
            arguments: raw.arguments,
          };
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
        if (detail.pendingApprovals?.length) {
          setPendingApprovals(detail.pendingApprovals);
        }
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
        setToolStatus([]);

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
        activeAssistantIdRef.current = assistantId;
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
          handleStreamChunks,
          () => {
            setStreaming(false);
            setToolStatus([]);
            // Remove empty streaming placeholders before server refresh replaces everything
            setMessages((prev) =>
              prev.filter(
                (m) => !(m.streaming && m.role === 'assistant' && !m.content && !m.toolCalls),
              ),
            );
            // Refresh to get authoritative server state (tool calls, tool responses)
            refreshMessages(activeChatId!);
          },
          (err: Error) => {
            setError(err.message);
            setStreaming(false);
            setToolStatus([]);
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
      activeAssistantIdRef.current = assistantId;
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
            handleStreamChunks,
            () => {
              setStreaming(false);
              setToolStatus([]);
              refreshMessages(currentChatId);
            },
            (err: Error) => {
              setError(err.message);
              setStreaming(false);
              setToolStatus([]);
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
    toolStatus,
    send,
    approve,
    reject,
    stop,
    clearError,
  };
}
