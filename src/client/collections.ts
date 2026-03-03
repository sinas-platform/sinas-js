import type { SinasClient } from './SinasClient';
import type { Collection, FileInfo } from './types';

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
