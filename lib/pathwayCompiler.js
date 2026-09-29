// lib/pathwayCompiler.js
// Compiles a Pathway document (nodes + edges) into a bounded, flat set of
// key/value variables that will be sent to Edesy via the documented
// `variables` field of POST /api/v1/calls.
//
// Edesy does NOT accept a workflow graph. The graph lives in MongoDB and in
// the visual builder; what Edesy receives is the *content* of the pathway
// (greeting, step texts, branch condition texts, etc.) as variables that the
// agent's prompt template (configured once in the Edesy dashboard) reads.
//
// No Edesy endpoint is invented here. This module never talks to Edesy.

const BRANCH_HANDLES = new Set(["out", "out-a", "out-b"]);
const MAX_STEPS = 20;            // safety bound on how many nodes we flatten
const MAX_TEXT_LEN = 500;        // per-variable value length

// Node types we understand. Anything else is skipped (with a warning) rather
// than failing the whole call — new node types must not break old pathways.
const KNOWN_TYPES = new Set([
  "start",
  "default",
  "conversation",
  "knowledge",
  "knowledgeBase",
  "transfer",
  "transferCall",
  "end",
  "endCall",
  "webhook",
  "waitForResponse",
  "wait",
  "transferPathway",
  "tool",
  "toolFromLibrary",
  "pressButton",
  "route",
  "sms",
  "customCode",
]);

export class PathwayCompileError extends Error {
  constructor(message, code = "PATHWAY_INVALID") {
    super(message);
    this.name = "PathwayCompileError";
    this.code = code;
    this.status = 400;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function nodeType(node) {
  return String(node?.type || node?.data?.type || "").trim();
}

function nodeLabel(node) {
  const d = node?.data || {};
  return String(d.name || d.label || d.title || "").trim();
}

function nodeText(node) {
  const d = node?.data || {};
  return String(
    d.description || d.text || d.prompt || d.message || d.content || ""
  ).trim();
}

function clampText(s) {
  if (typeof s !== "string") return "";
  const t = s.trim();
  return t.length > MAX_TEXT_LEN ? t.slice(0, MAX_TEXT_LEN) : t;
}

// Build a lookup of nodes by id, and validate that ids are unique & sane.
function indexNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new PathwayCompileError("This pathway has no nodes.", "NO_NODES");
  }
  const byId = new Map();
  for (const n of nodes) {
    const id = String(n?.id || "").trim();
    if (!id) {
      throw new PathwayCompileError(
        "A node is missing its id.",
        "NODE_MISSING_ID"
      );
    }
    if (byId.has(id)) {
      throw new PathwayCompileError(
        `Duplicate node id "${id}".`,
        "DUPLICATE_NODE_ID"
      );
    }
    byId.set(id, n);
  }
  return byId;
}

// Validate that every edge points to a real node with a real handle.
function validateEdges(edges, byId) {
  if (!Array.isArray(edges)) {
    throw new PathwayCompileError("This pathway has no edges array.", "NO_EDGES");
  }
  for (const e of edges) {
    if (!isPlainObject(e)) {
      throw new PathwayCompileError("An edge is malformed.", "EDGE_MALFORMED");
    }
    const source = String(e.source || "").trim();
    const target = String(e.target || "").trim();
    const handle = String(e.sourceHandle || "").trim();

    if (!source || !target) {
      throw new PathwayCompileError(
        "An edge is missing source or target.",
        "EDGE_MISSING_ENDPOINT"
      );
    }
    if (!byId.has(source)) {
      throw new PathwayCompileError(
        `Edge references unknown source node "${source}".`,
        "EDGE_UNKNOWN_SOURCE"
      );
    }
    if (!byId.has(target)) {
      throw new PathwayCompileError(
        `Edge references unknown target node "${target}".`,
        "EDGE_UNKNOWN_TARGET"
      );
    }
    if (handle && !BRANCH_HANDLES.has(handle)) {
      throw new PathwayCompileError(
        `Edge from "${source}" uses unknown sourceHandle "${handle}".`,
        "EDGE_BAD_HANDLE"
      );
    }
  }
}

// Outgoing edges from a node, grouped by handle.
function outEdgesByHandle(edges, sourceId) {
  const map = new Map();
  for (const e of edges) {
    if (String(e.source) !== sourceId) continue;
    const h = String(e.sourceHandle || "out");
    if (!map.has(h)) map.set(h, []);
    map.get(h).push(String(e.target));
  }
  return map;
}

// Depth-first walk from start, detecting cycles and collecting order.
// A cycle is reported as an error because a phone agent cannot spin forever.
function walkLinear({ startId, byId, edges, isBranchingType }) {
  const order = [];
  const onStack = new Set();
  const visited = new Set();

  let cursor = startId;
  let guard = 0;

  while (cursor) {
    if (guard++ > 1000) {
      throw new PathwayCompileError(
        "Pathway traversal did not terminate.",
        "TRAVERSAL_LOOP"
      );
    }
    if (onStack.has(cursor)) {
      throw new PathwayCompileError(
        `Cycle detected at node "${cursor}".`,
        "CYCLE_DETECTED"
      );
    }
    onStack.add(cursor);

    const node = byId.get(cursor);
    if (!node) {
      throw new PathwayCompileError(
        `Traversal reached unknown node "${cursor}".`,
        "TRAVERSAL_UNKNOWN"
      );
    }
    order.push(node);
    visited.add(cursor);

    const type = nodeType(node);
    const outs = outEdgesByHandle(edges, cursor);

    if (isBranchingType(type)) {
      // Route / branching node: stop the linear walk here and record branches.
      return { order, branchNode: node, branchOuts: outs, visited };
    }

    const nexts = outs.get("out") || [];
    if (nexts.length === 0) {
      // Terminal node (End Call or dangling). Stop.
      return { order, branchNode: null, branchOuts: outs, visited };
    }
    if (nexts.length > 1) {
      throw new PathwayCompileError(
        `Node "${cursor}" has multiple "out" edges. Only branching nodes may fan out.`,
        "NON_BRANCHING_FANOUT"
      );
    }

    onStack.delete(cursor); // linear step is done; no back-edge seen
    cursor = nexts[0];
  }

  return { order, branchNode: null, branchOuts: new Map(), visited };
}

// Walk a single branch linearly until it terminates or joins a visited node.
function walkBranch({ startId, byId, edges, visited }) {
  const order = [];
  let cursor = startId;
  let guard = 0;

  while (cursor) {
    if (guard++ > 1000) {
      throw new PathwayCompileError(
        "Branch traversal did not terminate.",
        "BRANCH_LOOP"
      );
    }
    if (visited.has(cursor)) {
      // Rejoined an already-seen node — acceptable, stop here.
      break;
    }
    visited.add(cursor);
    const node = byId.get(cursor);
    if (!node) {
      throw new PathwayCompileError(
        `Branch reached unknown node "${cursor}".`,
        "BRANCH_UNKNOWN"
      );
    }
    order.push(node);

    const type = nodeType(node);
    if (isBranchingType(type)) {
      // Nested branch — out of scope for a single-pass flatten. Stop.
      break;
    }

    const outs = outEdgesByHandle(edges, cursor);
    const nexts = outs.get("out") || [];
    if (nexts.length === 0) break;
    if (nexts.length > 1) {
      throw new PathwayCompileError(
        `Branch node "${cursor}" has multiple "out" edges.`,
        "BRANCH_FANOUT"
      );
    }
    cursor = nexts[0];
  }
  return order;
}

function isBranchingType(type) {
  const t = type.toLowerCase();
  return t === "route" || t === "branch" || t === "condition";
}

function isStartType(type) {
  const t = type.toLowerCase();
  return t === "start" || t === "trigger";
}

function isEndType(type) {
  const t = type.toLowerCase();
  return t === "end" || t === "endcall" || t === "end-call";
}

// Public API: pathway doc → { variables, metadata, warnings }
export function compilePathwayToVariables(pathway) {
  if (!pathway || typeof pathway !== "object") {
    throw new PathwayCompileError("Pathway is missing.", "NO_PATHWAY");
  }

  const byId = indexNodes(pathway.nodes);
  validateEdges(pathway.edges || [], byId);

  // 1. Find exactly one Start node.
  const starts = [];
  for (const n of byId.values()) {
    if (isStartType(nodeType(n))) starts.push(n);
  }
  if (starts.length === 0) {
    throw new PathwayCompileError(
      "Pathway has no Start node.",
      "NO_START"
    );
  }
  if (starts.length > 1) {
    throw new PathwayCompileError(
      "Pathway has more than one Start node.",
      "MULTIPLE_START"
    );
  }
  const startNode = starts[0];
  const startId = String(startNode.id);

  // 2. Start must have a single "out" edge.
  const startOuts = outEdgesByHandle(pathway.edges, startId).get("out") || [];
  if (startOuts.length === 0) {
    throw new PathwayCompileError(
      "Start node has no outgoing edge.",
      "START_NO_OUT"
    );
  }
  if (startOuts.length > 1) {
    throw new PathwayCompileError(
      "Start node has multiple outgoing edges.",
      "START_FANOUT"
    );
  }

  // 3. Linear walk from start until a branch or a terminal.
  const { order, branchNode, branchOuts, visited } = walkLinear({
    startId,
    byId,
    edges: pathway.edges,
    isBranchingType,
  });

  const warnings = [];
  const variables = {};
  const metadata = {
    pathway_name: clampText(pathway.name || "Untitled Pathway"),
  };

  // 4. Emit linear steps.
  let stepIndex = 0;
  for (const n of order) {
    const type = nodeType(n);
    if (!KNOWN_TYPES.has(type)) {
      warnings.push(`Skipped unknown node type "${type}".`);
      continue;
    }
    const key = stepIndex === 0 ? "greeting" : `step_${stepIndex}`;
    const text = clampText(nodeText(n));
    if (text) variables[key] = text;
    stepIndex++;
    if (stepIndex > MAX_STEPS) {
      warnings.push(`Only the first ${MAX_STEPS} steps were flattened.`);
      break;
    }
  }

  // 5. If we stopped at a branching node, emit both branches.
  if (branchNode) {
    const condition = clampText(branchNode.data?.ifCondition || "");
    variables.if_condition = condition || "(no condition set)";

    const ifTargets = branchOuts.get("out-a") || [];
    const elseTargets = branchOuts.get("out-b") || [];

    if (ifTargets.length === 0) {
      throw new PathwayCompileError(
        `Branch node "${branchNode.id}" has no "out-a" (If) branch.`,
        "BRANCH_NO_IF"
      );
    }
    if (elseTargets.length === 0) {
      throw new PathwayCompileError(
        `Branch node "${branchNode.id}" has no "out-b" (Otherwise) branch.`,
        "BRANCH_NO_ELSE"
      );
    }

    const ifWalk = walkBranch({
      startId: ifTargets[0],
      byId,
      edges: pathway.edges,
      visited: new Set(visited),
    });
    const elseWalk = walkBranch({
      startId: elseTargets[0],
      byId,
      edges: pathway.edges,
      visited: new Set(visited),
    });

    variables.if_branch = clampText(
      ifWalk.map(nodeText).filter(Boolean).join(" ")
    );
    variables.otherwise_branch = clampText(
      elseWalk.map(nodeText).filter(Boolean).join(" ")
    );
  }

  // 6. End Call reachability check — informational only, since a branch may
  //    legitimately end the call inside one arm.
  const anyEnd = [...byId.values()].some((n) => isEndType(nodeType(n)));
  if (!anyEnd) {
    warnings.push("Pathway has no End Call node.");
  }

  metadata.pathway_summary = buildSummary({ order, branchNode, variables });
  metadata.steps_count = String(stepIndex);

  return { variables, metadata, warnings };
}

function buildSummary({ order, branchNode, variables }) {
  const names = order.map((n) => nodeLabel(n) || nodeType(n) || "step");
  if (branchNode) {
    const cond = variables.if_condition || "(condition)";
    names.push(`Route: if ${cond} → ${variables.if_branch ? "if-branch" : "?"}; otherwise → ${variables.otherwise_branch ? "else-branch" : "?"}`);
  }
  return clampText(names.join(" → "));
}