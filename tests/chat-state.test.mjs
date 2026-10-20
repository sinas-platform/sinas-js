// useChat's state transitions (src/hooks/chatState.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const m = await load('../src/hooks/chatState.ts');
const now = new Date('2026-10-20T12:00:00Z');

test('message events carry answer text and/or thinking', () => {
  assert.deepEqual(m.parseMessageChunk('{"content":"hi"}'), { text: 'hi' });
  assert.deepEqual(m.parseMessageChunk('{"content":null,"thinking":""}'), { text: '', thinking: '' });
  assert.deepEqual(m.parseMessageChunk('{"content":null,"thinking":"hmm"}'), { text: '', thinking: 'hmm' });
  assert.deepEqual(m.parseMessageChunk('{"type":"tool_rejected","tool_call_id":"x"}'), { text: '' });
  assert.deepEqual(m.parseMessageChunk('null'), { text: '' });
  assert.deepEqual(m.parseMessageChunk('plain'), { text: 'plain' });
});

test('thinking: announced, accumulated, stopped, and a new round set apart', () => {
  const view = (t) => m.thinkingView(t);
  let t = m.NOT_THINKING;
  assert.deepEqual(view(t), { active: false, text: '' });
  t = m.applyThinking(t, '');
  assert.deepEqual(view(t), { active: true, text: '' });
  t = m.applyThinking(t, 'Let me ');
  t = m.applyThinking(t, 'see');
  assert.deepEqual(view(t), { active: true, text: 'Let me see' });
  t = m.stopThinking(t);
  assert.deepEqual(view(t), { active: false, text: 'Let me see' });
  // A later round (after a tool call): announced empty, then its text.
  t = m.applyThinking(t, '');
  assert.deepEqual(view(t), { active: true, text: 'Let me see' });
  t = m.applyThinking(t, 'Now the tool result');
  assert.deepEqual(view(t), { active: true, text: 'Let me see\n\nNow the tool result' });
  // A round whose text is never shown adds no separator.
  t = m.applyThinking(m.stopThinking(t), '');
  assert.equal(view(m.stopThinking(t)).text, 'Let me see\n\nNow the tool result');
  // No-op transitions keep the same object (no re-render).
  const stopped = m.stopThinking(t);
  assert.equal(m.stopThinking(stopped), stopped);
  const active = m.applyThinking(m.NOT_THINKING, 'x');
  assert.equal(m.applyThinking(active, ''), active);
});

test('streamed text grows one assistant message, then a new one after a tool bubble', () => {
  let msgs = [];
  msgs = m.applyTextDelta(msgs, 'Hel', 'c1', now);
  msgs = m.applyTextDelta(msgs, 'lo', 'c1', now);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].content, 'Hello');
  msgs = m.applyToolStart(msgs, { tool_call_id: 't1', name: 'search' }, 'c1', now);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].streaming, false);
  // The same tool_start again (a replayed channel) adds nothing.
  assert.equal(m.applyToolStart(msgs, { tool_call_id: 't1', name: 'search' }, 'c1', now), msgs);
  msgs = m.applyToolEnd(msgs, { tool_call_id: 't1', name: 'search', result: { ok: true } });
  assert.deepEqual(msgs[1].toolResults, { t1: { content: '{"ok":true}', name: 'search' } });
  msgs = m.applyTextDelta(msgs, 'Done', 'c1', now);
  assert.equal(msgs.length, 3);
});

test('approvals and questions are listed once each', () => {
  const a = { type: 'approval_required', toolCallId: 'x', functionNamespace: 'ns', functionName: 'f', arguments: {} };
  const once = m.addApproval([], a);
  assert.equal(m.addApproval(once, a), once);
  const q = (id) => ({ toolCallId: id, question: id, options: null, expiresAt: null, createdAt: null });
  const qs = m.mergePendingInputs([q('a')], [q('a'), q('b'), q('b')]);
  assert.deepEqual(qs.map((p) => p.toolCallId), ['a', 'b']);
  assert.equal(m.mergePendingInputs(qs, [q('a')]), qs);
});

test('the latest gate lets only the newest ticket write', () => {
  const gate = m.createLatestGate();
  const first = gate.next();
  const second = gate.next();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

test('polling while a question waits: capped, and just after the earliest deadline', () => {
  const nowMs = now.getTime();
  const q = (expiresAt) => ({ toolCallId: 'x', question: '', options: null, expiresAt, createdAt: null });
  assert.equal(m.nextPendingPollMs([q(null)], nowMs), m.PENDING_POLL_MAX_MS);
  assert.equal(m.nextPendingPollMs([q(new Date(nowMs + 10_000).toISOString())], nowMs), 15_000);
  // Overdue: check again soon until the expiry sweep has run.
  assert.equal(m.nextPendingPollMs([q(new Date(nowMs - 60_000).toISOString())], nowMs), 10_000);
  // Never faster than a second.
  assert.equal(m.nextPendingPollMs([q(new Date(nowMs - 4_900).toISOString())], nowMs), 1_000);
});
