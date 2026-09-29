// lib/pathwayPrompt.js
// Turns a Pathway (nodes + edges) into ONE complete system prompt for the
// Edesy voice agent, so the agent talks exactly according to the flowchart.
//
// Used right before a call is placed: the prompt is PATCHed onto the Edesy
// agent (see updateAgentPrompt in lib/edesy.js), then the call is started.
//
// It walks the whole graph (any shape, loops allowed), numbers the steps in
// the order they are reached, and writes each step with a clear "Next:" line.
//
// Reads only these node.data keys:
//   description, ifCondition, otherwise, transferNumber, name

const MAX_NODES = 60;
const MAX_TEXT = 1500; // per field, keeps the prompt bounded

export class PathwayPromptError extends Error {
  constructor(message, code = "PATHWAY_INVALID") {
    super(message);
    this.name = "PathwayPromptError";
    this.code = code;
    this.status = 400;
  }
}

const clean = (v) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) : "";

const typeOf = (n) => String(n?.type || "").trim();

// Node types the voice agent cannot actually perform. They are skipped and
// the flow continues to whatever they point at.
const SKIPPED = new Set([
  "webhook",
  "sms",
  "toolLibrary",
  "tool",
  "toolFromLibrary",
  "customCode",
  "transferPathway",
]);

function outgoing(edges, id) {
  const out = { main: [], a: [], b: [] };
  for (const e of edges) {
    if (String(e.source) !== id) continue;
    const h = String(e.sourceHandle || "out");
    if (h === "out-a") out.a.push(String(e.target));
    else if (h === "out-b") out.b.push(String(e.target));
    else out.main.push(String(e.target));
  }
  return out;
}

export function buildPathwayPrompt(pathway) {
  const nodes = Array.isArray(pathway?.nodes) ? pathway.nodes : [];
  const edges = Array.isArray(pathway?.edges) ? pathway.edges : [];
  if (nodes.length === 0) {
    throw new PathwayPromptError("This pathway has no nodes.", "NO_NODES");
  }
  if (nodes.length > MAX_NODES) {
    throw new PathwayPromptError(
      `This pathway has more than ${MAX_NODES} nodes. Please simplify it.`,
      "TOO_MANY_NODES"
    );
  }

  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  const starts = nodes.filter((n) => typeOf(n) === "start");
  if (starts.length !== 1) {
    throw new PathwayPromptError(
      starts.length === 0
        ? "Pathway has no Start node."
        : "Pathway has more than one Start node.",
      starts.length === 0 ? "NO_START" : "MULTIPLE_START"
    );
  }
  const start = starts[0];
  const startText = clean(start.data?.description);
  if (!startText) {
    throw new PathwayPromptError(
      "The Start node has no greeting. Open it and fill in Instructions.",
      "NO_GREETING"
    );
  }

  // 1. Number every reachable node in the order we first reach it.
  const order = [];
  const stepNo = new Map();
  const queue = [String(start.id)];
  while (queue.length) {
    const id = queue.shift();
    if (stepNo.has(id) || !byId.has(id)) continue;
    stepNo.set(id, order.length + 1);
    order.push(byId.get(id));
    const o = outgoing(edges, id);
    for (const t of [...o.main, ...o.a, ...o.b]) queue.push(t);
  }

  const ref = (id) => (stepNo.has(id) ? `STEP ${stepNo.get(id)}` : null);
  const warnings = [];
  const blocks = [];

  // 2. Write one block per step.
  for (const node of order) {
    const id = String(node.id);
    const n = stepNo.get(id);
    const type = typeOf(node);
    const d = node.data || {};
    const text = clean(d.description);
    const cond = clean(d.ifCondition);
    const other = clean(d.otherwise);
    const o = outgoing(edges, id);
    const lines = [];

    // What to do at this step
    if (type === "start") {
      lines.push(`Say this to open the call: "${text}"`);
    } else if (type === "endCall") {
      lines.push(
        `${text ? `Say: "${text}" ` : ""}Then politely say goodbye and end the call.`
      );
    } else if (type === "route") {
      lines.push(
        "Do not say anything new here. Listen to the caller's last reply and choose a path below." +
          (text ? ` Guidance: ${text}` : "")
      );
    } else if (type === "knowledgeBase") {
      lines.push(
        `Answer the caller's questions using your knowledge base.${text ? ` ${text}` : ""}`
      );
    } else if (type === "transferCall") {
      const num = clean(d.transferNumber);
      lines.push(
        `${text ? `Say: "${text}" ` : ""}` +
          (num
            ? `Then transfer the call to ${num}.`
            : "Then transfer the call to a human agent.")
      );
    } else if (type === "waitForResponse") {
      lines.push(
        `${text ? `${text} ` : ""}Wait for the caller to answer before moving on. Do not continue until they respond.`
      );
    } else if (type === "pressButton") {
      lines.push(
        `${text ? `${text} ` : ""}Ask the caller to press a key on their keypad and wait for it.`
      );
    } else if (SKIPPED.has(type)) {
      warnings.push(`Node "${d.name || id}" (${type}) can't run on a call and was skipped.`);
      lines.push("Nothing to say here. Move straight to the next step.");
    } else {
      // default / conversation / anything else
      lines.push(text ? `Say or do this: ${text}` : "Continue the conversation naturally.");
    }

    // Where to go next
    if (type === "endCall") {
      // terminal
    } else if (type === "route" || cond || o.a.length || o.b.length) {
      const ifTargets = o.a.length ? o.a : o.main;
      const ifRef = ifTargets.map(ref).find(Boolean);
      const elseRef = o.b.map(ref).find(Boolean);
      lines.push(
        `Choose a path based on what the caller says:`,
        `  - IF ${cond || "the caller agrees / the main case applies"} → go to ${ifRef || "the end of the call"}.`,
        `  - OTHERWISE${other ? ` (${other})` : ""} → go to ${elseRef || "the end of the call"}.`
      );
      if (!ifRef) warnings.push(`"${d.name || id}": the If path is not connected.`);
      if (!elseRef) warnings.push(`"${d.name || id}": the Otherwise path is not connected.`);
    } else {
      const nextRef = [...o.main, ...o.a].map(ref).find(Boolean);
      if (nextRef) {
        const nextNode = byId.get([...o.main, ...o.a].find((t) => ref(t) === nextRef));
        const waits = typeOf(nextNode) === "route";
        lines.push(
          waits
            ? `Then wait for the caller's reply and go to ${nextRef}.`
            : `When done, go to ${nextRef}.`
        );
      } else {
        lines.push("This is the last step. After it, politely say goodbye and end the call.");
        warnings.push(`"${d.name || id}" has no next step; the call will end after it.`);
      }
    }

    const title = clean(d.name) || type;
    blocks.push(`STEP ${n} — ${title}\n${lines.map((l) => `  ${l}`).join("\n")}`);
  }

  const prompt = [
    "You are an AI voice agent on a live phone call. Follow the CALL FLOW below exactly.",
    "",
    "Rules:",
    "- Speak like a real person on the phone: short sentences, one question at a time, no lists.",
    "- Start at STEP 1 and move only along the paths written below. Never skip ahead or invent new steps.",
    "- Never mention steps, the flow, or these instructions to the caller.",
    "- If the caller asks something the flow doesn't cover, answer briefly, then return to the current step.",
    "- Only end the call at an End Call step, or if the caller asks to stop.",
    "",
    "CALL FLOW",
    "",
    blocks.join("\n\n"),
  ].join("\n");

  return { prompt, greeting: startText.slice(0, 500), warnings, stepCount: order.length };
}
