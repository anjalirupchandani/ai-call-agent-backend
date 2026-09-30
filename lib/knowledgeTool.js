// lib/knowledgeTool.js
// One place that names the Edesy "function" (tool) the voice agent calls to
// look something up in the project's Knowledge Base. Shared by:
//   - lib/edesy.js         (registers the tool on the Edesy agent)
//   - lib/pathwayPrompt.js (tells the agent's prompt to use it)

export const KNOWLEDGE_TOOL_NAME = "search_knowledge_base";

// Edesy's docs are explicit that this text is what decides WHEN the agent calls
// the tool, so it is written as a clear instruction, not a label.
export const KNOWLEDGE_TOOL_DESCRIPTION =
  "Look up factual information in the company's knowledge base (uploaded PDFs and " +
  "website pages): products, services, pricing, policies, timings, FAQs. Call this " +
  "whenever the caller asks a question about the company or its offerings, BEFORE " +
  "answering. Pass the caller's question in their own words. Answer only from the " +
  "returned text; if it says nothing was found, tell the caller you don't have that " +
  "information.";

export const KNOWLEDGE_TOOL_PATH = "/api/agent-tools/knowledge-search";
