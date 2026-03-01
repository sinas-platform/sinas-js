import type { SinasClient } from './SinasClient';
import type { QueryResult } from './types';

function parseRef(ref: string): [string, string] {
  const parts = ref.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid query ref "${ref}": expected "namespace/name"`);
  }
  return [parts[0], parts[1]];
}

export async function executeQuery(
  client: SinasClient,
  ref: string,
  input: Record<string, unknown> = {}
): Promise<QueryResult> {
  const [ns, name] = parseRef(ref);
  const base = client.getProxyBase();
  const res = await client.fetch(`${base}/queries/${ns}/${name}/execute`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  });
  const data = await res.json();
  return {
    success: data.success,
    operation: data.operation,
    data: data.data,
    rowCount: data.row_count,
    affectedRows: data.affected_rows,
    durationMs: data.duration_ms,
  };
}
