// useChat (src/hooks/useChat.ts) rendered against a scripted API: approval
// rounds with always-allow and resume "waiting", ask_user questions live and
// on load with answers that resume the stream, thinking, and following a
// channel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
import { installFetch, json, openStream, waitFor, tick } from './fake-server.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;
const h = await load('./harness.ts');

const msg = (id, role, content) => ({ id, chat_id: 'c1', role, content, tool_calls: null, tool_call_id: null, name: null, created_at: '2026-10-20T10:00:00Z' });

/** Renders useChat; returns a getter for its latest result. */
function renderChat(options) {
  const client = new h.SinasClient({ baseUrl: 'http://sinas.test', getAccessToken: () => 'tok' });
  let latest;
  function Probe() {
    latest = h.useChat('ops/deployer', options);
    return null;
  }
  const renderer = h.create(h.React.createElement(h.SinasProvider, { client }, h.React.createElement(Probe)));
  return { get: () => latest, unmount: () => renderer.unmount() };
}

/** A fake chat API whose detail (GET /chats/c1) the test updates as the server state changes. */
function chatApi(extra = {}) {
  const state = { detail: { id: 'c1', agent_namespace: 'ops', agent_name: 'deployer', title: 't', messages: [], pending_approvals: [], pending_inputs: [] } };
  const streams = {};
  const calls = installFetch({
    'POST /agents/ops/deployer/chats': () => json({ id: 'c1', agent_namespace: 'ops', agent_name: 'deployer', title: 't' }),
    'GET /chats/c1': () => json(state.detail),
    'POST /chats/c1/messages/stream': () => (streams.send = openStream()).response(),
    ...extra,
  });
  return { state, streams, calls };
}

const approval = (id) => ({ type: 'approval_required', tool_call_id: id, function_namespace: 'ops', function_name: 'deploy', arguments: { env: id } });

test('a multi-call approval round resumes only after its last decision; always-allow is sent', async (t) => {
  const channels = {};
  const api = chatApi({
    'POST /chats/c1/approve-tool/a1': () => json({ status: 'approved', tool_call_id: 'a1', channel_id: 'r1', resume: 'waiting' }, 202),
    'POST /chats/c1/approve-tool/a2': () => json({ status: 'approved', tool_call_id: 'a2', channel_id: 'r1', resume: 'queued' }, 202),
    'GET /chats/c1/stream/r1': () => (channels.r1 = openStream()).response(),
  });
  t.after(api.calls.restore);
  const chat = renderChat({});
  t.after(chat.unmount);

  chat.get().send('deploy both');
  await waitFor(() => api.streams.send, 'send stream');
  api.streams.send.push([['approval_required', approval('a1')], ['approval_required', approval('a2')]]);
  await waitFor(() => chat.get().pendingApprovals.length === 2, 'two approvals');
  api.state.detail = { ...api.state.detail, messages: [msg('u1', 'user', 'deploy both')], pending_approvals: [approval('a1'), approval('a2')] };
  api.streams.send.push([['done', { status: 'completed' }]]);
  await waitFor(() => !chat.get().streaming, 'stream ended');

  // First decision: the round waits for the other one, nothing streams.
  chat.get().approve('a1', { alwaysAllow: true });
  await waitFor(() => api.calls.some((c) => c.path === '/chats/c1/approve-tool/a1'), 'approve a1');
  const a1 = api.calls.find((c) => c.path === '/chats/c1/approve-tool/a1');
  assert.deepEqual(a1.body, { approved: true, always_allow: true });
  await tick();
  await tick();
  assert.deepEqual(chat.get().pendingApprovals.map((a) => a.toolCallId), ['a2']);
  assert.equal(chat.get().streaming, false);
  assert.equal(channels.r1, undefined);

  // Last decision: the round resumes on its channel.
  chat.get().approve('a2');
  await waitFor(() => channels.r1, 'resume stream');
  assert.deepEqual(api.calls.find((c) => c.path === '/chats/c1/approve-tool/a2').body, { approved: true });
  assert.equal(chat.get().streaming, true);
  channels.r1.push([['message', { content: 'Deployed both.' }]]);
  await waitFor(() => chat.get().messages.some((m) => m.content === 'Deployed both.'), 'resumed text');
  api.state.detail = { ...api.state.detail, messages: [msg('u1', 'user', 'deploy both'), msg('m2', 'assistant', 'Deployed both.')], pending_approvals: [] };
  channels.r1.push([['done', { status: 'completed' }]]);
  await waitFor(() => !chat.get().streaming && chat.get().messages[1]?.id === 'm2', 'refreshed');
  assert.equal(chat.get().pendingApprovals.length, 0);
});

test('a final rejection follows the resumed round; on a pre-0.5 server it does not', async (t) => {
  const channels = {};
  let resume = 'queued';
  const api = chatApi({
    'POST /chats/c1/approve-tool/a1': () =>
      json({ status: 'rejected', tool_call_id: 'a1', channel_id: 'r1', ...(resume ? { resume } : {}) }, 202),
    'GET /chats/c1/stream/r1': () => (channels.r1 = openStream()).response(),
  });
  t.after(api.calls.restore);
  api.state.detail.pending_approvals = [approval('a1')];
  const chat = renderChat({ chatId: 'c1' });
  t.after(chat.unmount);
  await waitFor(() => chat.get().pendingApprovals.length === 1, 'loaded approval');

  chat.get().reject('a1');
  await waitFor(() => channels.r1, 'rejection resume stream');
  assert.deepEqual(api.calls.find((c) => c.path === '/chats/c1/approve-tool/a1').body, { approved: false });
  channels.r1.push([['done', { status: 'completed' }]]);
  await waitFor(() => !chat.get().streaming, 'ended');

  // Pre-0.5: no `resume`, a rejection resumes nothing; the chat is re-read.
  resume = undefined;
  delete channels.r1;
  const reads = api.calls.filter((c) => c.path === '/chats/c1').length;
  chat.get().reject('a1');
  await waitFor(() => api.calls.filter((c) => c.path === '/chats/c1').length > reads, 'refresh');
  assert.equal(channels.r1, undefined);
});

test('ask_user: the question arrives live, the answer resumes the stream; thinking is shown', async (t) => {
  const channels = {};
  const api = chatApi({
    'POST /chats/c1/pending-input/q1': () =>
      json({ status: 'answered', tool_call_id: 'q1', resumed: true, resume_pending: false, channel_id: 'r2', message: 'ok' }, 202),
    'GET /chats/c1/stream/r2': () => (channels.r2 = openStream()).response(),
  });
  t.after(api.calls.restore);
  const options = { includeThinking: true };
  const chat = renderChat(options);
  t.after(chat.unmount);

  chat.get().send('deploy');
  await waitFor(() => api.streams.send, 'send stream');
  assert.deepEqual(api.calls.find((c) => c.path === '/chats/c1/messages/stream').body, { content: 'deploy', include_thinking: true });

  api.streams.send.push([
    ['message', { content: null, thinking: '' }],
    ['message', { content: null, thinking: 'Which environment?' }],
  ]);
  await waitFor(() => chat.get().thinking.text === 'Which environment?', 'thinking text');
  assert.equal(chat.get().thinking.active, true);

  const question = { type: 'input_required', tool_call_id: 'q1', question: 'Deploy to which env?', options: ['dev', 'prod'], expires_at: null };
  api.streams.send.push([
    ['message', { content: 'Let me ask.' }],
    ['input_required', question],
    ['round_suspended', { type: 'round_suspended', tool_call_ids: ['q1'], channel_id: 'r1' }],
  ]);
  await waitFor(() => chat.get().pendingInputs.length === 1, 'question');
  assert.deepEqual(chat.get().pendingInputs[0], { toolCallId: 'q1', question: 'Deploy to which env?', options: ['dev', 'prod'], expiresAt: null, createdAt: null });
  assert.equal(chat.get().thinking.active, false);
  assert.equal(chat.get().thinking.text, 'Which environment?');

  // The turn parks: done {"status":"suspended"}; the re-read keeps the question.
  api.state.detail = { ...api.state.detail, messages: [msg('u1', 'user', 'deploy'), msg('m1', 'assistant', 'Let me ask.')], pending_inputs: [question] };
  api.streams.send.push([['done', { status: 'suspended' }]]);
  await waitFor(() => !chat.get().streaming && chat.get().messages[1]?.id === 'm1', 'parked + refreshed');
  assert.equal(chat.get().pendingInputs.length, 1);

  const answered = await chat.get().answer('q1', 'dev');
  assert.equal(answered, true);
  assert.deepEqual(api.calls.find((c) => c.path === '/chats/c1/pending-input/q1').body, { answer: 'dev' });
  await waitFor(() => channels.r2, 'resume stream');
  assert.equal(api.calls.find((c) => c.path === '/chats/c1/stream/r2').query.include_thinking, 'true');
  assert.equal(chat.get().pendingInputs.length, 0);
  assert.equal(chat.get().streaming, true);
  // A new stream starts with fresh thinking.
  assert.deepEqual(chat.get().thinking, { active: false, text: '' });

  channels.r2.push([['message', { content: 'Deployed to dev.' }]]);
  await waitFor(() => chat.get().messages.some((m) => m.content === 'Deployed to dev.'), 'reply');
  api.state.detail = { ...api.state.detail, messages: [...api.state.detail.messages, msg('m2', 'assistant', 'Deployed to dev.')], pending_inputs: [] };
  channels.r2.push([['done', { status: 'completed' }]]);
  await waitFor(() => !chat.get().streaming && chat.get().messages[2]?.id === 'm2', 'final refresh');
});

test('questions are loaded with the chat; an answer that is not the last one streams nothing', async (t) => {
  const api = chatApi({
    'POST /chats/c1/pending-input/q1': () =>
      json({ status: 'answered', tool_call_id: 'q1', resumed: false, resume_pending: false, channel_id: null, message: 'waiting' }, 202),
    'POST /chats/c1/pending-input/gone': () => json({ detail: 'Pending input not found or already answered' }, 404),
  });
  t.after(api.calls.restore);
  api.state.detail.pending_inputs = [
    { tool_call_id: 'q1', question: 'First?', options: null, expires_at: null, created_at: null },
    { tool_call_id: 'q2', question: 'Second?', options: null, expires_at: null, created_at: null },
  ];
  const chat = renderChat({ chatId: 'c1', pollPendingInputs: false });
  t.after(chat.unmount);
  await waitFor(() => chat.get().pendingInputs.length === 2, 'loaded questions');

  assert.equal(await chat.get().answer('q1', 'yes'), true);
  await tick();
  assert.deepEqual(chat.get().pendingInputs.map((p) => p.toolCallId), ['q2']);
  assert.equal(chat.get().streaming, false);
  assert.ok(!api.calls.some((c) => c.path.startsWith('/chats/c1/stream/')));

  // A failed answer reports the error and re-reads what is still open.
  api.state.detail = { ...api.state.detail, pending_inputs: [{ tool_call_id: 'q2', question: 'Second?' }] };
  assert.equal(await chat.get().answer('gone', 'x'), false);
  assert.match(chat.get().error, /not found/);
});

test('follow streams a channel into the session', async (t) => {
  const channels = {};
  const api = chatApi({ 'GET /chats/c1/stream/run9': () => (channels.run9 = openStream()).response() });
  t.after(api.calls.restore);
  const chat = renderChat({ chatId: 'c1' });
  t.after(chat.unmount);
  await waitFor(() => chat.get().chatId === 'c1' && !chat.get().loading, 'loaded');

  chat.get().follow('run9', { lastId: '12-0' });
  await waitFor(() => channels.run9, 'follow stream');
  assert.deepEqual(api.calls.find((c) => c.path === '/chats/c1/stream/run9').query, { last_id: '12-0' });
  channels.run9.push([['tool_start', { tool_call_id: 't1', name: 'build', description: 'Building' }]]);
  await waitFor(() => chat.get().toolStatus.length === 1, 'tool status');
  channels.run9.push([['done', { status: 'completed' }]]);
  await waitFor(() => !chat.get().streaming, 'ended');
});
