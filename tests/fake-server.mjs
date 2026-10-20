// A scripted stand-in for the Sinas API: routes `fetch` calls to handlers
// and records them. SSE responses are streams the test pushes events into.

export const API = 'http://sinas.test/api/v1';

export function sse(events) {
  return events.map(([event, data]) => `event: ${event}\r\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\r\n\r\n`).join('');
}

/** An SSE response whose events the test writes (and ends) when it wants. */
export function openStream() {
  let controller;
  const body = new ReadableStream({ start(c) { controller = c; } });
  const enc = new TextEncoder();
  return {
    response: () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    push(events) { controller.enqueue(enc.encode(sse(events))); },
    raw(text) { controller.enqueue(enc.encode(text)); },
    end() { try { controller.close(); } catch { /* already closed */ } },
  };
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Installs a fake fetch. `routes` maps "METHOD /path" (path relative to
 * API, without query) to a handler (req) => Response | Promise<Response>.
 * Returns the recorded calls; `restore()` puts the real fetch back.
 */
export function installFetch(routes) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api\/v1/, '');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const call = { method, path, query: Object.fromEntries(u.searchParams), body, headers: init.headers || {} };
    calls.push(call);
    const handler = routes[`${method} ${path}`];
    if (!handler) return json({ detail: `no route ${method} ${path}` }, 404);
    return handler(call);
  };
  calls.restore = () => { globalThis.fetch = real; };
  return calls;
}

export const tick = () => new Promise((r) => setTimeout(r, 0));

/** Polls until `check()` is truthy (or throws after ~1s). */
export async function waitFor(check, what = 'condition') {
  for (let i = 0; i < 200; i++) {
    const v = check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}
