import type { SinasClient } from './SinasClient';
import type { ChatCreateResult, ChatMessage, SSEChunk } from './types';

export async function createChat(
  client: SinasClient,
  agentRef: string,
  input?: Record<string, unknown>
): Promise<ChatCreateResult> {
  const [ns, name] = agentRef.split('/');
  if (!ns || !name) {
    throw new Error(`Invalid agent ref "${agentRef}": expected "namespace/name"`);
  }
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

export async function sendMessage(
  client: SinasClient,
  chatId: string,
  content: string
): Promise<ChatMessage> {
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
  };
}

function parseSSE(buffer: string): { chunks: SSEChunk[]; remaining: string } {
  const chunks: SSEChunk[] = [];
  const lines = buffer.split('\n');
  let event = '';
  let data = '';
  let remaining = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // If last line and doesn't end with newline, it's incomplete
    if (i === lines.length - 1 && !buffer.endsWith('\n')) {
      remaining = line;
      break;
    }

    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data = line.slice(5).trim();
    } else if (line === '') {
      if (event || data) {
        chunks.push({ event: event || 'message', data });
        event = '';
        data = '';
      }
    }
  }

  return { chunks, remaining };
}

export function streamMessage(
  client: SinasClient,
  chatId: string,
  content: string,
  onChunk: (chunk: SSEChunk) => void,
  onDone?: () => void,
  onError?: (error: Error) => void
): AbortController {
  const controller = new AbortController();
  const config = client.getConfig();

  (async () => {
    try {
      const res = await fetch(`${config.apiBase}/chats/${chatId}/messages/stream`, {
        method: 'POST',
        headers: client.getAuthHeaders(),
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(body.detail || 'Stream request failed');
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
            onDone?.();
            return;
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const { chunks } = parseSSE(buffer + '\n\n');
        for (const chunk of chunks) {
          onChunk(chunk);
        }
      }

      onDone?.();
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      onError?.(err as Error);
    }
  })();

  return controller;
}
