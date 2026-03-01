import type { SinasClient } from './SinasClient';
import type { FunctionResult } from './types';

function parseRef(ref: string): [string, string] {
  const parts = ref.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid function ref "${ref}": expected "namespace/name"`);
  }
  return [parts[0], parts[1]];
}

export async function executeFunction(
  client: SinasClient,
  ref: string,
  input: Record<string, unknown> = {},
  timeout?: number
): Promise<FunctionResult> {
  const [ns, name] = parseRef(ref);
  const base = client.getProxyBase();
  const body: Record<string, unknown> = { input };
  if (timeout !== undefined) {
    body.timeout = timeout;
  }
  const res = await client.fetch(`${base}/functions/${ns}/${name}/execute`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return {
    status: data.status,
    executionId: data.execution_id,
    result: data.result,
    error: data.error,
  };
}
