import * as React from 'react';
import cytoscape, { type Core } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { GraphResponse } from '../api';

cytoscape.use(fcose);

export interface GraphCanvasHandle {
  fit: () => void;
  relayout: () => void;
}

export interface GraphCanvasProps {
  graph: GraphResponse | null;
  search: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export const GraphCanvas = React.forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  ({ graph, search, selectedId, onSelect }, ref) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const cyRef = React.useRef<Core | null>(null);

    React.useImperativeHandle(ref, () => ({
      fit: () => {
        cyRef.current?.fit(undefined, 40);
      },
      relayout: () => {
        const cy = cyRef.current;
        if (!cy) return;
        cy.layout({ name: 'fcose', animate: false }).run();
      },
    }));

    // (Re)build graph when data changes
    React.useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      // Destroy previous instance
      cyRef.current?.destroy();
      cyRef.current = null;

      if (!graph) {
        return;
      }

      const elements = [
        ...graph.nodes.map((n) => ({
          data: { id: n.id, label: n.label, path: n.path, kind: n.kind },
        })),
        ...graph.edges.map((e) => ({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            kind: e.kind,
            count: e.count ?? 1,
          },
        })),
      ];

      const cy = cytoscape({
        container,
        elements,
        wheelSensitivity: 0.15,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': '#60a5fa',
              width: 16,
              height: 16,
              label: 'data(label)',
              color: '#e5e7eb',
              'font-size': 10,
              'text-outline-color': '#0b1220',
              'text-outline-width': 2,
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 6,
            },
          },
          {
            selector: 'edge',
            style: {
              width: 1,
              'line-color': '#334155',
              'target-arrow-color': '#334155',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              opacity: 0.75,
            },
          },
          {
            selector: "edge[kind = 'call']",
            style: {
              'line-color': '#a78bfa',
              'target-arrow-color': '#a78bfa',
            },
          },
          {
            selector: '.selected',
            style: {
              'background-color': '#f59e0b',
              width: 22,
              height: 22,
            },
          },
          {
            selector: '.match',
            style: {
              'background-color': '#22c55e',
            },
          },
          {
            selector: '.dim',
            style: {
              opacity: 0.15,
            },
          },
        ],
        layout: { name: 'fcose', animate: false },
      });

      cy.on('tap', 'node', (evt) => {
        const id = evt.target.id();
        onSelect(id);
      });

      cy.on('tap', (evt) => {
        if (evt.target === cy) onSelect(null);
      });

      cyRef.current = cy;

      // Initial fit
      cy.fit(undefined, 40);

      return () => {
        cy.destroy();
        cyRef.current = null;
      };
    }, [graph, onSelect]);

    // Selection highlight
    React.useEffect(() => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.nodes().removeClass('selected');
      if (selectedId) {
        cy.getElementById(selectedId).addClass('selected');
      }
    }, [selectedId]);

    // Search highlight + dim non-matching nodes (optional)
    React.useEffect(() => {
      const cy = cyRef.current;
      if (!cy) return;

      cy.nodes().removeClass('match dim');
      if (!search.trim()) {
        return;
      }

      const q = search.trim().toLowerCase();
      const matches = cy
        .nodes()
        .filter((n) => (n.data('label') as string).toLowerCase().includes(q) || (n.data('path') as string).toLowerCase().includes(q));

      matches.addClass('match');
      cy.nodes().difference(matches).addClass('dim');
    }, [search]);

    return <div ref={containerRef} className="h-full w-full" />;
  }
);
GraphCanvas.displayName = 'GraphCanvas';

