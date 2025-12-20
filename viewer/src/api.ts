export type GraphMode = 'deps' | 'calls';

export interface IndexInfo {
  name: string;
  rootPath: string;
  status: string;
  model: string;
  chunkCount: number;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: 'file';
  path: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: 'import' | 'call';
  count?: number;
}

export interface GraphResponse {
  mode: GraphMode;
  indexName: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function fetchIndexes(): Promise<IndexInfo[]> {
  const res = await fetch('/api/indexes', { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Failed to load indexes (${res.status})`);
  }
  const data = (await res.json()) as { indexes: IndexInfo[] };
  return data.indexes;
}

export async function fetchGraph(params: {
  index: string;
  mode: GraphMode;
  external: boolean;
}): Promise<GraphResponse> {
  const url = new URL('/api/graph', window.location.origin);
  url.searchParams.set('index', params.index);
  url.searchParams.set('mode', params.mode);
  url.searchParams.set('external', params.external ? '1' : '0');

  const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to load graph (${res.status}): ${text}`);
  }
  return (await res.json()) as GraphResponse;
}

