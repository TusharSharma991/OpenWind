import React, { useCallback, useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "@dagrejs/dagre";

// ── Types ────────────────────────────────────────────────────────────────────

type WorkflowState = {
  id: string;
  name: string;
  label: string;
  color: string | null;
  isTerminal: boolean;
  slaHours: number | null;
  sortOrder: number;
};

type WorkflowTransition = {
  id: string;
  fromState: string;
  toState: string;
  label: string;
};

type CanvasProps = {
  states: WorkflowState[];
  transitions: WorkflowTransition[];
  initialState: string;
  workflowId: string;
  isAdmin: boolean;
};

type StateNodeData = {
  state: WorkflowState;
  isInitial: boolean;
};

// ── Constants ────────────────────────────────────────────────────────────────

const NODE_W = 160;
const NODE_H = 72;

// ── localStorage helpers ─────────────────────────────────────────────────────

function posKey(workflowId: string): string {
  return `wf-canvas-positions-${workflowId}`;
}

function savePositions(workflowId: string, nodes: Node<StateNodeData>[]): void {
  const map: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) map[n.id] = n.position;
  localStorage.setItem(posKey(workflowId), JSON.stringify(map));
}

function loadPositions(
  workflowId: string,
): Record<string, { x: number; y: number }> | null {
  const raw = localStorage.getItem(posKey(workflowId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, { x: number; y: number }>;
  } catch {
    return null;
  }
}

// ── dagre layout ─────────────────────────────────────────────────────────────

function applyDagreLayout(
  nodes: Node<StateNodeData>[],
  edges: Edge[],
): Node<StateNodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 70, ranksep: 100 });

  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) {
    if (e.source !== e.target) g.setEdge(e.source, e.target);
  }

  dagre.layout(g as Parameters<typeof dagre.layout>[0]);

  return nodes.map((n) => {
    const pos = g.node(n.id) as { x: number; y: number } | undefined;
    const position: { x: number; y: number } = pos
      ? { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 }
      : n.position;
    return { ...n, position };
  });
}

// ── Custom state node ────────────────────────────────────────────────────────

function StateNode({ data }: NodeProps<StateNodeData>): React.ReactElement {
  const { state, isInitial } = data;
  const accent = state.color ?? "#6366f1";

  return (
    <div
      style={{
        width: NODE_W,
        height: NODE_H,
        background: "var(--bg-card, #fff)",
        border: state.isTerminal
          ? `3px double ${accent}`
          : `1.5px solid ${accent}`,
        borderRadius: "10px",
        boxShadow: "0 1px 4px rgba(0,0,0,.08)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "8px 12px",
        position: "relative",
        fontSize: "12px",
        userSelect: "none",
      }}
    >
      {isInitial && (
        <span
          style={{
            position: "absolute",
            top: "-8px",
            left: "10px",
            fontSize: "9px",
            fontWeight: 700,
            color: accent,
            background: "var(--bg-card, #fff)",
            padding: "0 4px",
            letterSpacing: "0.4px",
          }}
        >
          START
        </span>
      )}
      {state.isTerminal && (
        <span
          style={{
            position: "absolute",
            bottom: "-8px",
            left: "10px",
            fontSize: "9px",
            fontWeight: 700,
            color: "var(--text-muted, #888)",
            background: "var(--bg-card, #fff)",
            padding: "0 4px",
            letterSpacing: "0.4px",
          }}
        >
          END
        </span>
      )}
      <div
        style={{
          fontWeight: 700,
          color: "var(--text-primary, #111)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {state.label}
      </div>
      <div
        style={{
          fontSize: "10px",
          color: "var(--text-muted, #888)",
          marginTop: "2px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {state.name}
      </div>
      {state.slaHours !== null && (
        <div
          style={{
            position: "absolute",
            top: "6px",
            right: "8px",
            fontSize: "9px",
            fontWeight: 700,
            color: "var(--warning, #f59e0b)",
            background: "hsla(38,92%,50%,.12)",
            borderRadius: "8px",
            padding: "1px 5px",
          }}
        >
          SLA {state.slaHours}h
        </div>
      )}
      {/* ReactFlow handle points */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          transform: "translateY(-50%)",
          width: 0,
          height: 0,
        }}
        className="react-flow__handle react-flow__handle-left"
        data-handleid="left"
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          right: 0,
          transform: "translateY(-50%)",
          width: 0,
          height: 0,
        }}
        className="react-flow__handle react-flow__handle-right"
        data-handleid="right"
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
        }}
        className="react-flow__handle react-flow__handle-top"
        data-handleid="top"
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
        }}
        className="react-flow__handle react-flow__handle-bottom"
        data-handleid="bottom"
      />
    </div>
  );
}

// ── Custom labelled edge ──────────────────────────────────────────────────────

function LabelledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  source,
  target,
}: EdgeProps & {
  data?: { label: string };
  source: string;
  target: string;
}): React.ReactElement {
  const isSelfLoop = source === target;

  let edgePath: string;
  let labelX: number;
  let labelY: number;

  if (isSelfLoop) {
    // Self-loop rendered as a small circle above the node
    const r = 30;
    const cx = sourceX;
    const cy = sourceY - r * 2;
    edgePath = `M ${sourceX} ${sourceY} C ${cx - r} ${cy} ${cx + r} ${cy} ${sourceX} ${sourceY}`;
    labelX = cx;
    labelY = cy - 10;
  } else {
    [edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  }

  const label = (data as { label?: string } | undefined)?.label ?? "";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(typeof markerEnd === "string" ? { markerEnd } : {})}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              fontSize: "10px",
              fontWeight: 600,
              color: "var(--accent-primary, #6366f1)",
              background: "var(--bg-primary, #fff)",
              padding: "1px 5px",
              borderRadius: "4px",
              border: "1px solid var(--border-color, #e5e7eb)",
              pointerEvents: "none",
              whiteSpace: "nowrap",
              maxWidth: "120px",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// ── Node types registration ─────────────────────────────────────────────────

const NODE_TYPES = { stateNode: StateNode };
const EDGE_TYPES = { labelledEdge: LabelledEdge };

// ── Helpers: build RF nodes/edges from workflow data ─────────────────────────

function buildNodes(
  states: WorkflowState[],
  initialState: string,
): Node<StateNodeData>[] {
  return states.map((s) => ({
    id: s.id,
    type: "stateNode",
    position: { x: 0, y: 0 },
    data: { state: s, isInitial: s.name === initialState },
    draggable: true,
  }));
}

function buildEdges(
  transitions: WorkflowTransition[],
  statesByName: Map<string, WorkflowState>,
): Edge[] {
  return transitions
    .map((t) => {
      const src = statesByName.get(t.fromState);
      const tgt = statesByName.get(t.toState);
      if (!src || !tgt) return null;
      return {
        id: t.id,
        source: src.id,
        target: tgt.id,
        type: "labelledEdge",
        data: { label: t.label },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: {
          stroke: "var(--accent-primary, #6366f1)",
          strokeWidth: 1.5,
          opacity: 0.75,
        },
      } satisfies Edge;
    })
    .filter(Boolean) as Edge[];
}

// ── Main canvas component ────────────────────────────────────────────────────

export function WorkflowCanvas({
  states,
  transitions,
  initialState,
  workflowId,
  isAdmin,
}: CanvasProps): React.ReactElement {
  const statesByName = useMemo(
    () => new Map(states.map((s) => [s.name, s])),
    [states],
  );

  const initialNodes = useMemo(() => {
    const rawNodes = buildNodes(states, initialState);
    const rawEdges = buildEdges(transitions, statesByName);
    const saved = loadPositions(workflowId);
    if (saved) {
      return rawNodes.map((n) => {
        const pos = saved[n.id];
        return pos ? { ...n, position: pos } : n;
      });
    }
    return applyDagreLayout(rawNodes, rawEdges);
  }, [states, initialState, transitions, statesByName, workflowId]);

  const initialEdges = useMemo(
    () => buildEdges(transitions, statesByName),
    [transitions, statesByName],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Persist positions on drag-end
  const onNodeDragStop = useCallback(() => {
    savePositions(workflowId, nodes as Node<StateNodeData>[]);
  }, [nodes, workflowId]);

  // Sync when workflow data changes (e.g., after state edit)
  useEffect(() => {
    const rawNodes = buildNodes(states, initialState);
    const rawEdges = buildEdges(transitions, statesByName);
    const saved = loadPositions(workflowId);
    setNodes(
      saved
        ? rawNodes.map((n) => {
            const pos = saved[n.id];
            return pos ? { ...n, position: pos } : n;
          })
        : applyDagreLayout(rawNodes, rawEdges),
    );
    setEdges(rawEdges);
  }, [
    states,
    transitions,
    initialState,
    statesByName,
    workflowId,
    setNodes,
    setEdges,
  ]);

  function resetLayout(): void {
    localStorage.removeItem(posKey(workflowId));
    const rawNodes = buildNodes(states, initialState);
    const rawEdges = buildEdges(transitions, statesByName);
    setNodes(applyDagreLayout(rawNodes, rawEdges));
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "420px" }}>
      <button
        onClick={resetLayout}
        style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          zIndex: 10,
          padding: "4px 10px",
          fontSize: "11px",
          fontWeight: 600,
          background: "var(--bg-secondary, #f8f8f8)",
          border: "1px solid var(--border-color, #e5e7eb)",
          borderRadius: "6px",
          cursor: "pointer",
          color: "var(--text-secondary, #555)",
        }}
      >
        Reset layout
      </button>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={isAdmin ? onNodesChange : undefined}
        onEdgesChange={isAdmin ? onEdgesChange : undefined}
        onNodeDragStop={isAdmin ? onNodeDragStop : undefined}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodesDraggable={isAdmin}
        nodesConnectable={false}
        elementsSelectable={isAdmin}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.3}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        style={{
          background: "var(--bg-tertiary, #f4f4f6)",
          borderRadius: "8px",
        }}
      >
        <Background
          color="var(--border-color, #e5e7eb)"
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
        />
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            const d = n.data as StateNodeData | undefined;
            return d?.state.color ?? "#6366f1";
          }}
          style={{ background: "var(--bg-secondary, #f0f0f3)" }}
        />
      </ReactFlow>
    </div>
  );
}
