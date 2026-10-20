// The chat client functions (src/client/chat.ts) against a scripted API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
import { API, installFetch, json, openStream, waitFor } from './fake-server.mjs';

const sdk = await load('../src/client/index.ts');
const client = new sdk.SinasClient({ baseUrl: 'http://sinas.test', getAccessToken: () => 'tok' });

test('approve with always-allow; the response says whether the round resumes', async (t) => {
  const calls = installFetch({
    'POST /chats/c1/approve-tool/call%2F1': () =>
      json({ status: 'approved', tool_call_id: 'call/1', channel_id: 'ch1', resume: 'waiting', message: 'Decision recorded' }, 202),
  });
  t.after(calls.restore);
  const result = await sdk.approveToolCall(client, 'c1', 'call/1', true, { alwaysAllow: true });
  assert.deepEqual(calls[0].body, { approved: true, always_allow: true });
  assert.deepEqual(result, { status: 'approved', toolCallId: 'call/1', channelId: 'ch1', resume: 'waiting', message: 'Decision recorded' });
  assert.equal(sdk.approvalResumeChannel(result, true), null);
});

test('always-allow is not sent with a rejection; old servers omit resume', async (t) => {
  const calls = installFetch({
    'POST /chats/c1/approve-tool/t1': () => json({ status: 'rejected', tool_call_id: 't1', channel_id: 'ch1' }, 202),
  });
  t.after(calls.restore);
  const result = await sdk.approveToolCall(client, 'c1', 't1', false, { alwaysAllow: true });
  assert.deepEqual(calls[0].body, { approved: false });
  assert.equal(result.resume, undefined);
  // The 0.7 call shape (no options) still works.
  await sdk.approveToolCall(client, 'c1', 't1', true);
  assert.deepEqual(calls[1].body, { approved: true });
});

test('pending inputs: listed, answered (202), and answered with wait (200)', async (t) => {
  const calls = installFetch({
    'GET /chats/c1/pending-input': () =>
      json([{ tool_call_id: 'q1', question: 'Which env?', options: ['dev', 'prod'], expires_at: null, created_at: '2026-10-20T10:00:00Z' }]),
    'POST /chats/c1/pending-input/q1': (req) =>
      req.body.wait
        ? json({
            status: 'completed', pending_inputs: [], channel_id: null, tool_call_id: 'q1', chat_id: 'c1', reply: 'Deployed to dev.',
            message: { id: 'm9', chat_id: 'c1', role: 'assistant', content: 'Deployed to dev.', tool_calls: null, tool_call_id: null, name: null, created_at: '2026-10-20T10:01:00Z' },
            usage: { calls: 1, prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.001, unpriced_calls: 0, errors: 0 },
          })
        : json({ status: 'answered', tool_call_id: 'q1', resumed: true, resume_pending: false, channel_id: 'ch2', message: 'Resume job enqueued.' }, 202),
  });
  t.after(calls.restore);

  const inputs = await sdk.listPendingInputs(client, 'c1');
  assert.deepEqual(inputs, [{ toolCallId: 'q1', question: 'Which env?', options: ['dev', 'prod'], expiresAt: null, createdAt: '2026-10-20T10:00:00Z' }]);

  const accepted = await sdk.answerPendingInput(client, 'c1', 'q1', 'dev');
  assert.deepEqual(calls[1].body, { answer: 'dev' });
  assert.deepEqual(accepted, { status: 'answered', toolCallId: 'q1', resumed: true, resumePending: false, channelId: 'ch2', message: 'Resume job enqueued.' });
  assert.equal(sdk.answerResumeChannel(accepted), 'ch2');

  const waited = await sdk.answerPendingInput(client, 'c1', 'q1', 'dev', { wait: true });
  assert.deepEqual(calls[2].body, { answer: 'dev', wait: true });
  assert.equal(waited.status, 'completed');
  assert.equal(waited.reply, 'Deployed to dev.');
  assert.equal(waited.message.content, 'Deployed to dev.');
  assert.equal(waited.message.chatId, 'c1');
  assert.equal(waited.usage.totalTokens, 8);
});

test('invoke and non-streaming send report how the turn ended', async (t) => {
  const asked = { tool_call_id: 'q1', question: 'Which env?', options: null };
  const calls = installFetch({
    'POST /agents/ops/deployer/invoke': () =>
      json({ reply: 'Let me check.', chat_id: 'c1', session_key: 's1', status: 'input_required', pending_inputs: [asked], channel_id: null, usage: null }),
    'POST /chats/c1/messages': () =>
      json({ id: 'm1', chat_id: 'c1', role: 'assistant', content: 'Hi', tool_calls: null, tool_call_id: null, name: null, created_at: 'now' }),
  });
  t.after(calls.restore);

  const invoked = await sdk.invokeAgent(client, 'ops/deployer', 'deploy', { sessionKey: 's1', input: { team: 'a' } });
  assert.deepEqual(calls[0].body, { message: 'deploy', session_key: 's1', input: { team: 'a' } });
  assert.equal(invoked.status, 'input_required');
  assert.equal(invoked.reply, 'Let me check.');
  assert.equal(invoked.chatId, 'c1');
  assert.equal(invoked.pendingInputs[0].toolCallId, 'q1');

  // A pre-0.5 server's send response: base fields as before, turn completed.
  const sent = await sdk.sendMessage(client, 'c1', 'hello');
  assert.deepEqual(sent, { id: 'm1', chatId: 'c1', role: 'assistant', content: 'Hi', createdAt: 'now', status: 'completed', pendingInputs: [], channelId: null, usage: null });
  await assert.rejects(sdk.invokeAgent(client, 'bad', 'x'), /namespace\/name/);
});

test('chat detail includes the questions when the server reports them', async (t) => {
  const base = { id: 'c1', agent_namespace: 'ops', agent_name: 'a', title: 't', messages: [], pending_approvals: [{ tool_call_id: 'a1', function_namespace: 'ns', function_name: 'f', arguments: { x: 1 } }] };
  let detail = { ...base, pending_inputs: [{ tool_call_id: 'q1', question: 'Q?' }] };
  const calls = installFetch({ 'GET /chats/c1': () => json(detail) });
  t.after(calls.restore);
  const chat = await sdk.getChat(client, 'c1');
  assert.equal(chat.pendingInputs[0].question, 'Q?');
  assert.deepEqual(chat.pendingApprovals, [{ type: 'approval_required', toolCallId: 'a1', functionNamespace: 'ns', functionName: 'f', arguments: { x: 1 } }]);
  detail = base; // pre-0.5: no field
  assert.equal((await sdk.getChat(client, 'c1')).pendingInputs, undefined);
});

test('streams: include_thinking is sent, and done says suspended', async (t) => {
  const stream = openStream();
  const calls = installFetch({
    'POST /chats/c1/messages/stream': () => stream.response(),
    'GET /chats/c1/stream/ch9': () => {
      const s = openStream();
      s.push([['message', { content: 'resumed' }], ['done', { status: 'completed' }]]);
      return s.response();
    },
  });
  t.after(calls.restore);

  const chunks = [];
  let done = null;
  sdk.streamMessage(client, 'c1', 'hi', (c) => chunks.push(c), (d) => { done = d; }, undefined, { includeThinking: true });
  await waitFor(() => calls.length === 1, 'stream request');
  assert.deepEqual(calls[0].body, { content: 'hi', include_thinking: true });
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  stream.push([
    ['message', { content: null, thinking: '' }],
    ['input_required', { type: 'input_required', tool_call_id: 'q1', question: 'Q?' }],
    ['round_suspended', { type: 'round_suspended', tool_call_ids: ['q1'], channel_id: 'ch9' }],
  ]);
  // A done event split across two reads.
  stream.raw('event: done\r\nda');
  stream.raw('ta: {"status":"suspended"}\r\n\r\n');
  await waitFor(() => done, 'done');
  assert.deepEqual(done, { status: 'suspended' });
  assert.deepEqual(chunks.map((c) => c.event), ['message', 'input_required', 'round_suspended', 'done']);

  let followed = null;
  sdk.streamFromChannel(client, 'c1', 'ch9', () => {}, (d) => { followed = d; }, undefined, { includeThinking: true, lastId: '5-0' });
  await waitFor(() => followed, 'follow done');
  assert.deepEqual(calls[1].query, { last_id: '5-0', include_thinking: 'true' });
  assert.deepEqual(followed, { status: 'completed' });
});

test('a stream that ends without done reports closed', async (t) => {
  const calls = installFetch({
    'GET /chats/c1/stream/ch1': () => {
      const s = openStream();
      s.push([['message', { content: 'x' }]]);
      s.end();
      return s.response();
    },
  });
  t.after(calls.restore);
  let done = null;
  sdk.streamFromChannel(client, 'c1', 'ch1', () => {}, (d) => { done = d; });
  await waitFor(() => done, 'done');
  assert.deepEqual(done, { status: 'closed' });
  assert.deepEqual(calls[0].query, { last_id: '0' });
});
