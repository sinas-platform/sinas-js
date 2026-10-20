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

export interface EnqueueFunctionOptions {
  /** App-supplied correlation id stored on the execution record. */
  triggerId?: string;
  /** Delay before the worker picks up the job, in seconds. */
  delaySeconds?: number;
  /**
   * HTTPS URL Sinas will POST to once the execution terminates.
   * Must match the instance's CALLBACK_URL_HOSTS allowlist.
   */
  callbackUrl?: string;
}

export interface EnqueueFunctionResult {
  executionId: string;
  status: string;
}

/**
 * Fire-and-forget function enqueue. Returns immediately with the
 * execution_id. Poll `executions.get(id)` or rely on the callback URL
 * if one was provided.
 *
 * Standalone-mode only — uses the SinasClient's baseUrl (set in the
 * constructor). Embedded components should use `executeFunction` instead.
 */
export async function enqueueFunction(
  client: SinasClient,
  ref: string,
  input: Record<string, unknown> = {},
  options: EnqueueFunctionOptions = {},
): Promise<EnqueueFunctionResult> {
  const [ns, name] = parseRef(ref);
  const baseUrl = client.requireBaseUrl();
  const body: Record<string, unknown> = { input };
  if (options.triggerId !== undefined) body.trigger_id = options.triggerId;
  if (options.delaySeconds !== undefined) body.delay_seconds = options.delaySeconds;
  if (options.callbackUrl !== undefined) body.callback_url = options.callbackUrl;

  const res = await client.fetch(`${baseUrl}/functions/${ns}/${name}/execute/async`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return {
    executionId: data.execution_id,
    status: data.status,
  };
}

export interface SubmitFunctionBatchOptions {
  triggerIdPrefix?: string;
  delaySeconds?: number;
  /** Fires once per execution. */
  callbackUrl?: string;
  /** Fires once when the entire batch terminates. */
  batchCallbackUrl?: string;
}

export interface SubmitFunctionBatchResult {
  batchId: string;
  executionIds: string[];
  total: number;
  status: string;
}

/** Submit N function executions as a single batch. */
export async function submitFunctionBatch(
  client: SinasClient,
  ref: string,
  inputs: Record<string, unknown>[],
  options: SubmitFunctionBatchOptions = {},
): Promise<SubmitFunctionBatchResult> {
  const [ns, name] = parseRef(ref);
  const baseUrl = client.requireBaseUrl();
  const body: Record<string, unknown> = { inputs };
  if (options.triggerIdPrefix !== undefined) body.trigger_id_prefix = options.triggerIdPrefix;
  if (options.delaySeconds !== undefined) body.delay_seconds = options.delaySeconds;
  if (options.callbackUrl !== undefined) body.callback_url = options.callbackUrl;
  if (options.batchCallbackUrl !== undefined) body.batch_callback_url = options.batchCallbackUrl;

  const res = await client.fetch(`${baseUrl}/functions/${ns}/${name}/execute/batch`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return {
    batchId: data.batch_id,
    executionIds: data.execution_ids,
    total: data.total,
    status: data.status,
  };
}

export interface AgentBatchItem {
  inputVariables?: Record<string, unknown>;
  message: string;
}

export interface SubmitAgentBatchOptions {
  triggerIdPrefix?: string;
  callbackUrl?: string;
  batchCallbackUrl?: string;
}

export interface SubmitAgentBatchResult {
  batchId: string;
  executionIds: string[];
  chatIds: string[];
  total: number;
  status: string;
}

/** Submit N agent invocations as a single batch. */
export async function submitAgentBatch(
  client: SinasClient,
  ref: string,
  inputs: AgentBatchItem[],
  options: SubmitAgentBatchOptions = {},
): Promise<SubmitAgentBatchResult> {
  const [ns, name] = parseRef(ref);
  const baseUrl = client.requireBaseUrl();
  const body: Record<string, unknown> = {
    inputs: inputs.map((item) => ({
      input_variables: item.inputVariables || {},
      message: item.message,
    })),
  };
  if (options.triggerIdPrefix !== undefined) body.trigger_id_prefix = options.triggerIdPrefix;
  if (options.callbackUrl !== undefined) body.callback_url = options.callbackUrl;
  if (options.batchCallbackUrl !== undefined) body.batch_callback_url = options.batchCallbackUrl;

  const res = await client.fetch(`${baseUrl}/agents/${ns}/${name}/chats/batch`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return {
    batchId: data.batch_id,
    executionIds: data.execution_ids,
    chatIds: data.chat_ids,
    total: data.total,
    status: data.status,
  };
}

export interface BatchStatus {
  batchId: string;
  kind: string;
  target: { namespace: string; name: string };
  userId: string;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
  queued: number;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  triggerIdPrefix: string | null;
}

/** Get aggregate progress for a batch. */
export async function getBatch(
  client: SinasClient,
  batchId: string,
): Promise<BatchStatus> {
  const baseUrl = client.requireBaseUrl();
  const res = await client.fetch(`${baseUrl}/batches/${batchId}`);
  const data = await res.json();
  return {
    batchId: data.batch_id,
    kind: data.kind,
    target: data.target,
    userId: data.user_id,
    total: data.total,
    completed: data.completed,
    failed: data.failed,
    cancelled: data.cancelled,
    running: data.running,
    queued: data.queued,
    status: data.status,
    startedAt: data.started_at,
    finishedAt: data.finished_at,
    triggerIdPrefix: data.trigger_id_prefix,
  };
}

export interface BatchExecutionItem {
  executionId: string;
  status: string;
  functionName: string;
  chatId: string | null;
  triggerId: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

/** List child executions of a batch, optionally filtered by status. */
export async function listBatchExecutions(
  client: SinasClient,
  batchId: string,
  options: { status?: string; limit?: number; offset?: number } = {},
): Promise<BatchExecutionItem[]> {
  const baseUrl = client.requireBaseUrl();
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  const q = params.toString();
  const res = await client.fetch(
    `${baseUrl}/batches/${batchId}/executions${q ? '?' + q : ''}`,
  );
  const data = await res.json();
  return (data.executions || []).map((row: Record<string, unknown>) => ({
    executionId: row.execution_id as string,
    status: row.status as string,
    functionName: row.function_name as string,
    chatId: (row.chat_id as string | null) ?? null,
    triggerId: row.trigger_id as string,
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    durationMs: (row.duration_ms as number | null) ?? null,
    error: (row.error as string | null) ?? null,
  }));
}

/** Cancel any queued/pending children of a batch. */
export async function cancelBatch(
  client: SinasClient,
  batchId: string,
): Promise<{ batchId: string; status: string; cancelledChildren: number }> {
  const baseUrl = client.requireBaseUrl();
  const res = await client.fetch(`${baseUrl}/batches/${batchId}/cancel`, {
    method: 'POST',
  });
  const data = await res.json();
  return {
    batchId: data.batch_id,
    status: data.status,
    cancelledChildren: data.cancelled_children,
  };
}
