import * as React from 'react';
import { fetchGraph, fetchIndexes, type GraphMode, type GraphResponse, type IndexInfo } from './api';
import { GraphCanvas, type GraphCanvasHandle } from './components/GraphCanvas';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Separator } from './components/ui/separator';
import { Switch } from './components/ui/switch';

function getInitialParams(): { index?: string; mode?: GraphMode; external?: boolean } {
  const url = new URL(window.location.href);
  const index = url.searchParams.get('index') ?? undefined;
  const modeParam = url.searchParams.get('mode');
  const mode: GraphMode | undefined = modeParam === 'calls' ? 'calls' : modeParam === 'deps' ? 'deps' : undefined;
  const external = url.searchParams.get('external') === '1';
  return { index, mode, external };
}

export function App() {
  const initial = React.useMemo(getInitialParams, []);
  const canvasRef = React.useRef<GraphCanvasHandle | null>(null);

  const [indexes, setIndexes] = React.useState<IndexInfo[]>([]);
  const [indexName, setIndexName] = React.useState<string>(initial.index ?? '');
  const [mode, setMode] = React.useState<GraphMode>(initial.mode ?? 'deps');
  const [external, setExternal] = React.useState<boolean>(initial.external ?? false);
  const [search, setSearch] = React.useState('');

  const [graph, setGraph] = React.useState<GraphResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // Load indexes once
  React.useEffect(() => {
    let cancelled = false;
    fetchIndexes()
      .then((items) => {
        if (cancelled) return;
        setIndexes(items);
        if (!indexName && items.length > 0) {
          setIndexName(items[0]!.name);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch graph when selection changes
  React.useEffect(() => {
    if (!indexName) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedId(null);

    fetchGraph({ index: indexName, mode, external })
      .then((g) => {
        if (cancelled) return;
        setGraph(g);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setGraph(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [indexName, mode, external]);

  const selectedNode = React.useMemo(() => {
    if (!graph || !selectedId) return null;
    return graph.nodes.find((n) => n.id === selectedId) ?? null;
  }, [graph, selectedId]);

  const selectedStats = React.useMemo(() => {
    if (!graph || !selectedId) return null;
    const inbound = graph.edges.filter((e) => e.target === selectedId).length;
    const outbound = graph.edges.filter((e) => e.source === selectedId).length;
    const topOutbound = graph.edges
      .filter((e) => e.source === selectedId)
      .slice(0, 20)
      .map((e) => {
        const target = graph.nodes.find((n) => n.id === e.target);
        return {
          id: e.id,
          target: target?.label ?? e.target,
          count: e.count ?? 1,
          kind: e.kind,
        };
      });
    return { inbound, outbound, topOutbound };
  }, [graph, selectedId]);

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="font-semibold">lgrep graph</div>
        <Separator orientation="vertical" className="h-6" />

        <div className="flex min-w-[220px] items-center gap-2">
          <div className="text-xs text-muted-foreground">Index</div>
          <Select value={indexName} onValueChange={setIndexName}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="Select an index" />
            </SelectTrigger>
            <SelectContent>
              {indexes.map((idx) => (
                <SelectItem key={idx.name} value={idx.name}>
                  {idx.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">Mode</div>
          <Select value={mode} onValueChange={(v) => setMode(v as GraphMode)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="deps">Dependencies</SelectItem>
              <SelectItem value="calls">Calls</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">External</div>
          <Switch checked={external} onCheckedChange={setExternal} />
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <Input
            className="w-[280px]"
            placeholder="Search nodes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button variant="outline" onClick={() => canvasRef.current?.fit()} disabled={!graph}>
            Fit
          </Button>
          <Button variant="outline" onClick={() => canvasRef.current?.relayout()} disabled={!graph}>
            Re-layout
          </Button>
        </div>
      </div>

      <Separator />

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 bg-background">
          {loading && (
            <div className="absolute left-4 top-16 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow">
              Loading graph…
            </div>
          )}
          {error && (
            <div className="absolute left-4 top-16 max-w-[640px] rounded-md border border-border bg-card px-3 py-2 text-sm text-destructive shadow">
              {error}
            </div>
          )}
          <div className="h-full w-full">
            <GraphCanvas
              ref={canvasRef}
              graph={graph}
              search={search}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        </div>

        <Separator orientation="vertical" />

        <div className="w-[360px] shrink-0 overflow-auto p-4">
          <div className="text-sm font-medium">Details</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Click a node to inspect inbound/outbound edges.
          </div>

          <Separator className="my-3" />

          {!selectedNode && <div className="text-sm text-muted-foreground">No node selected.</div>}

          {selectedNode && selectedStats && (
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground">Path</div>
                <div className="break-words text-sm">{selectedNode.path}</div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border bg-card p-2">
                  <div className="text-xs text-muted-foreground">Inbound</div>
                  <div className="text-lg font-semibold">{selectedStats.inbound}</div>
                </div>
                <div className="rounded-md border border-border bg-card p-2">
                  <div className="text-xs text-muted-foreground">Outbound</div>
                  <div className="text-lg font-semibold">{selectedStats.outbound}</div>
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground">Outbound (sample)</div>
                <div className="mt-2 space-y-1">
                  {selectedStats.topOutbound.length === 0 && (
                    <div className="text-sm text-muted-foreground">None</div>
                  )}
                  {selectedStats.topOutbound.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="truncate">
                        <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {e.kind}
                        </span>
                        {e.target}
                      </div>
                      <div className="shrink-0 text-xs text-muted-foreground">{e.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

