// routes/agentTools.js
// Endpoints called BY the Edesy voice agent mid-call (not by the browser).
// Mounted in index.js BEFORE express.json() and WITHOUT requireAuth: it reads
// the body as raw text so a malformed-JSON body (caller's words containing a
// quote) can still be salvaged, and it authenticates with X-Tool-Secret.
import express, { Router } from "express";
import { knowledgeSearch } from "../controllers/agentToolsController.js";
import { KNOWLEDGE_TOOL_PATH } from "../lib/knowledgeTool.js";

const router = Router();

router.post(
  KNOWLEDGE_TOOL_PATH.replace("/api/agent-tools", ""),
  express.text({ type: () => true, limit: "20kb" }),
  knowledgeSearch
);

export default router;
