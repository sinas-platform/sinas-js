import type { SinasClient } from './SinasClient';
import type { StateGetResult, StateListResult } from './types';

export async function stateGet(
  client: SinasClient,
  ns: string,
  key: string
): Promise<StateGetResult> {
  const base = client.getProxyBase();
  const res = await client.fetch(`${base}/states/${ns}`, {
    method: 'POST',
    body: JSON.stringify({ action: 'get', key }),
  });
  return res.json();
}

export async function stateSet(
  client: SinasClient,
  ns: string,
  key: string,
  value: unknown,
  visibility: 'private' | 'shared' = 'private'
): Promise<void> {
  const base = client.getProxyBase();
  await client.fetch(`${base}/states/${ns}`, {
    method: 'POST',
    body: JSON.stringify({ action: 'set', key, value, visibility }),
  });
}

export async function stateDelete(
  client: SinasClient,
  ns: string,
  key: string
): Promise<void> {
  const base = client.getProxyBase();
  await client.fetch(`${base}/states/${ns}`, {
    method: 'POST',
    body: JSON.stringify({ action: 'delete', key }),
  });
}

export async function stateList(
  client: SinasClient,
  ns: string
): Promise<StateListResult> {
  const base = client.getProxyBase();
  const res = await client.fetch(`${base}/states/${ns}`, {
    method: 'POST',
    body: JSON.stringify({ action: 'list' }),
  });
  return res.json();
}
