// Parsers for chat API payloads and stream events (src/client/chatEvents.ts)
// and the SSE framing (parseSSE in src/client/chat.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const ev = await load('../src/client/chatEvents.ts');
const { parseSSE } = await load('../src/client/chat.ts');

test('a pending input is parsed from the API shape; junk is not one', () => {
  assert.deepEqual(
    ev.parsePendingInput({ tool_call_id: 'c1', question: 'Which?', options: ['a', 'b'], expires_at: '2026-10-21T00:00:00Z', created_at: '2026-10-20T00:00:00Z' }),
    { toolCallId: 'c1', question: 'Which?', options: ['a', 'b'], expiresAt: '2026-10-21T00:00:00Z', createdAt: '2026-10-20T00:00:00Z' },
  );
  assert.deepEqual(ev.parsePendingInput({ tool_call_id: 'c2' }), {
    toolCallId: 'c2', question: '', options: null, expiresAt: null, createdAt: null,
  });
  // Empty or non-string options mean a free-text question.
  assert.equal(ev.parsePendingInput({ tool_call_id: 'c3', options: [] }).options, null);
  assert.equal(ev.parsePendingInput({ tool_call_id: 'c3', options: [1, 2] }).options, null);
  assert.equal(ev.parsePendingInput({ question: 'no id' }), null);
  assert.equal(ev.parsePendingInput(null), null);
  assert.deepEqual(ev.parsePendingInputs([{ tool_call_id: 'x' }, 'junk', {}]).map((p) => p.toolCallId), ['x']);
  assert.deepEqual(ev.parsePendingInputs(undefined), []);
});

test('input_required arrives as its own event or as a typed message event', () => {
  const data = JSON.stringify({ type: 'input_required', tool_call_id: 'c1', question: 'Q?' });
  assert.equal(ev.pendingInputFromChunk({ event: 'input_required', data }).toolCallId, 'c1');
  assert.equal(ev.pendingInputFromChunk({ event: 'message', data }).question, 'Q?');
  assert.equal(ev.pendingInputFromChunk({ event: 'message', data: JSON.stringify({ content: 'hi' }) }), null);
  assert.equal(ev.pendingInputFromChunk({ event: 'tool_start', data }), null);
  assert.equal(ev.pendingInputFromChunk({ event: 'input_required', data: 'not json' }), null);
});

test('turn state: Sinas 0.5 fields are mapped; older servers default to completed', () => {
  const state = ev.parseTurnState({
    status: 'input_required',
    pending_inputs: [{ tool_call_id: 'c1', question: 'Q?' }],
    channel_id: null,
    usage: { calls: 1, prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: null, unpriced_calls: 1, errors: 0 },
  });
  assert.equal(state.status, 'input_required');
  assert.equal(state.pendingInputs[0].toolCallId, 'c1');
  assert.deepEqual(state.usage, {
    calls: 1, promptTokens: 10, completionTokens: 2, totalTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null, unpricedCalls: 1, errors: 0,
  });
  assert.deepEqual(ev.parseTurnState({}), { status: 'completed', pendingInputs: [], channelId: null, usage: null });
  assert.equal(ev.parseTurnState({ status: 'something_new' }).status, 'completed');
});

test('approval decisions: waiting streams nothing, queued follows the channel', () => {
  assert.equal(ev.approvalResumeChannel({ resume: 'waiting', channelId: 'ch' }), null);
  assert.equal(ev.approvalResumeChannel({ resume: 'queued', channelId: 'ch' }), 'ch');
  // A final rejection resumes too (the model gets the rejection result).
  assert.equal(ev.approvalResumeChannel({ resume: 'queued', channelId: 'ch' }, false), 'ch');
  // Servers before 0.5 (no `resume`): an approval resumes, a rejection doesn't.
  assert.equal(ev.approvalResumeChannel({ channelId: 'ch' }, true), 'ch');
  assert.equal(ev.approvalResumeChannel({ channelId: 'ch' }, false), null);
});

test('answers: only the round\'s last completion has a channel to follow', () => {
  assert.equal(ev.answerResumeChannel({ resumed: true, resumePending: false, channelId: 'ch' }), 'ch');
  assert.equal(ev.answerResumeChannel({ resumed: false, resumePending: true, channelId: 'ch' }), 'ch');
  assert.equal(ev.answerResumeChannel({ resumed: false, resumePending: false, channelId: null }), null);
});

test('done says how the stream ended', () => {
  assert.deepEqual(ev.parseDone('{"status":"suspended"}'), { status: 'suspended' });
  assert.deepEqual(ev.parseDone('{"status":"completed"}'), { status: 'completed' });
  assert.deepEqual(ev.parseDone(''), { status: 'completed' });
});

test('SSE: only complete events are emitted, whatever the read boundaries', () => {
  const text = 'event: input_required\r\ndata: {"tool_call_id":"c1"}\r\n\r\nevent: done\r\ndata: {"status":"suspended"}\r\n\r\n';
  // Every split point gives the same events.
  for (let cut = 0; cut <= text.length; cut++) {
    const first = parseSSE(text.slice(0, cut));
    const second = parseSSE(first.remaining + text.slice(cut));
    assert.deepEqual(
      [...first.chunks, ...second.chunks],
      [
        { event: 'input_required', data: '{"tool_call_id":"c1"}' },
        { event: 'done', data: '{"status":"suspended"}' },
      ],
      `split at ${cut}`,
    );
    assert.equal(second.remaining, '');
  }
});

test('SSE: data-only events are messages; pings come through', () => {
  const { chunks } = parseSSE('data: {"content":"hi"}\n\nevent: ping\ndata: \n\n');
  assert.deepEqual(chunks, [
    { event: 'message', data: '{"content":"hi"}' },
    { event: 'ping', data: '' },
  ]);
});
