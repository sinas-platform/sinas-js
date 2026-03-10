import type { SinasClient } from './SinasClient';
import type { Collection, FileInfo, FileUploadRequest, FileUrlResult } from './types';

export async function listCollections(client: SinasClient): Promise<Collection[]> {
  const base = client.getProxyBase();
  const res = await client.fetch(`${base}/collections`);
  return res.json();
}

export async function listFiles(
  client: SinasClient,
  namespace: string,
  collection: string
): Promise<FileInfo[]> {
  const base = client.getProxyBase();
  const res = await client.fetch(`${base}/files/${namespace}/${collection}`);
  return res.json();
}

export async function uploadFile(
  client: SinasClient,
  namespace: string,
  collection: string,
  data: FileUploadRequest,
): Promise<FileInfo> {
  const apiBase = client.getConfig().apiBase;
  const res = await client.fetch(`${apiBase}/files/${namespace}/${collection}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function generateFileUrl(
  client: SinasClient,
  namespace: string,
  collection: string,
  filename: string,
  expiresIn?: number,
): Promise<FileUrlResult> {
  const apiBase = client.getConfig().apiBase;
  const params = new URLSearchParams();
  if (expiresIn) params.set('expires_in', String(expiresIn));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await client.fetch(
    `${apiBase}/files/${namespace}/${collection}/${encodeURIComponent(filename)}/url${qs}`,
    { method: 'POST' },
  );
  return res.json();
}
