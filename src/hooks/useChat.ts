import React from 'react';
import { createChat, sendMessage, streamMessage } from '../client/chat';
import { useClient } from './context';
import type { ChatMessage, SSEChunk } from '../client/types';

export interface UseChatResult {
  chatId: string | null;
  messages: ChatMessage[];
  loading: boolean;
  streaming: boolean;
  error: string | null;
  createChat: (input?: Record<string, unknown>) => Promise<string | undefined>;
  sendMessage: (content: string) => Promise<ChatMessage | undefined>;
  streamMessage: (content: string) => AbortController | undefined;
}

export function useChat(agentRef: string): UseChatResult {
  const client = useClient();

  const [chatId, setChatId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const abortRef = React.useRef<AbortController | null>(null);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const doCreateChat = React.useCallback(
    async (input?: Record<string, unknown>) => {
      setLoading(true);
      setError(null);
      try {
        const result = await createChat(client, agentRef, input);
        setChatId(result.id);
        setMessages([]);
        return result.id;
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [client, agentRef]
  );

  const doSendMessage = React.useCallback(
    async (content: string) => {
      if (!chatId) {
        setError('No active chat. Call createChat first.');
        return;
      }
      setLoading(true);
      setError(null);

      // Add user message optimistically
      const userMsg: ChatMessage = {
        id: `tmp-${Date.now()}`,
        chatId,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMsg]);

      try {
        const msg = await sendMessage(client, chatId, content);
        setMessages(prev => [...prev, msg]);
        return msg;
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [client, chatId]
  );

  const doStreamMessage = React.useCallback(
    (content: string) => {
      if (!chatId) {
        setError('No active chat. Call createChat first.');
        return;
      }

      abortRef.current?.abort();
      setStreaming(true);
      setError(null);

      // Add user message optimistically
      const userMsg: ChatMessage = {
        id: `tmp-${Date.now()}`,
        chatId,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMsg]);

      // Add empty assistant message to accumulate chunks
      const assistantId = `stream-${Date.now()}`;
      const assistantMsg: ChatMessage = {
        id: assistantId,
        chatId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);

      const controller = streamMessage(
        client,
        chatId,
        content,
        (chunk: SSEChunk) => {
          if (chunk.event === 'content' || chunk.event === 'message') {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content + chunk.data } : m
              )
            );
          }
        },
        () => {
          setStreaming(false);
        },
        (err: Error) => {
          setError(err.message);
          setStreaming(false);
        }
      );

      abortRef.current = controller;
      return controller;
    },
    [client, chatId]
  );

  return {
    chatId,
    messages,
    loading,
    streaming,
    error,
    createChat: doCreateChat,
    sendMessage: doSendMessage,
    streamMessage: doStreamMessage,
  };
}
