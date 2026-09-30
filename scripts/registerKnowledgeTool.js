// scripts/registerKnowledgeTool.js
// Registers (or updates) the "search_knowledge_base" tool on your Edesy agent,
// pointing it at this backend's public ngrok URL.
//
//   npm run kb:register
//
// Re-run it whenever your ngrok URL changes (free ngrok URLs change on restart
// unless you use a reserved domain).
//
// Reads from .env:  PUBLIC_BASE_URL, KB_TOOL_SECRET, EDESY_API_KEY, EDESY_AGENT_ID
import "dotenv/config";
import { upsertKnowledgeTool, EdesyError } from "../lib/edesy.js";

try {
  const r = await upsertKnowledgeTool({
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    toolSecret: process.env.KB_TOOL_SECRET,
  });
  console.log(`✅ Tool ${r.action} (id ${r.id})`);
  console.log(`   Edesy will call: ${r.url}`);
} catch (err) {
  console.error(`❌ ${err instanceof EdesyError ? err.message : err}`);
  process.exit(1);
}
