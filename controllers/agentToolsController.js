// controllers/agentToolsController.js
// Endpoint the Edesy voice agent calls DURING a live call (server-to-server).
//
//   POST /api/agent-tools/knowledge-search
//   Header: X-Tool-Secret: <KB_TOOL_SECRET>
//   Body:   { "question": "...", "conversation_id": "<Edesy conversationId>" }
//   Reply:  { found, answer, sources, note }   ← Edesy hands this JSON to the agent
//
// Not behind requireAuth: Edesy has no user JWT. It is protected by a shared
// secret instead, and the KB it searches is the one owned by whoever placed the
// call (looked up from the conversation id we stored in Call.executionId).

import crypto from "node:crypto";
import Call from "../lib/models/Call.js";
import KnowledgeArticle from "../lib/models/KnowledgeArticle.js";
import { searchKnowledge } from "../lib/knowledgeSearch.js";

const NOT_FOUND_ANSWER =
  "Nothing about that was found in the knowledge base. Tell the caller you don't have that information and offer to have someone follow up. Do not guess.";
const VOICE_NOTE =
  "Answer the caller in one or two short spoken sentences using only the text in 'answer'.";

// ── helpers ───────────────────────────────────────────────────────────────────

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();

function secretOk(provided, expected) {
  if (!expected || !provided) return false;
  return crypto.timingSafeEqual(sha(provided), sha(expected)); // equal-length digests
}

/**
 * Edesy fills {{question}} into a JSON string template. If the caller's words
 * contain a quote or a newline and Edesy doesn't escape them, the body is not
 * valid JSON. Try strict JSON first, then salvage the two fields we need.
 */
export function parseToolBody(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw || "");
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object") return j;
  } catch {
    /* fall through to salvage */
  }
  const q = text.match(/"question"\s*:\s*"([\s\S]*?)"\s*,\s*"conversation_id"/);
  const c = text.match(/"conversation_id"\s*:\s*"([^"]*)"/);
  return { question: q ? q[1] : "", conversation_id: c ? c[1] : "" };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── handler factory (dependencies injectable for tests) ───────────────────────

export function makeKnowledgeSearchHandler({
  CallModel = Call,
  ArticleModel = KnowledgeArticle,
  getSecret = () => process.env.KB_TOOL_SECRET?.trim(),
  getFallbackUserId = () => process.env.KB_FALLBACK_USER_ID?.trim(),
  wait = sleep,
} = {}) {
  return async function knowledgeSearchHandler(req, res) {
    const expected = getSecret();
    if (!expected) {
      console.error("[kb-tool] KB_TOOL_SECRET is not set — refusing all requests");
      return res.status(503).json({ found: false, message: "Knowledge tool is not configured." });
    }
    if (!secretOk(req.get("x-tool-secret"), expected)) {
      console.warn("[kb-tool] rejected request: bad or missing X-Tool-Secret");
      return res.status(401).json({ found: false, message: "Unauthorized." });
    }

    const { question, conversation_id: conversationId } = parseToolBody(req.body);
    const q = String(question || "").trim().slice(0, 500);
    const cid = String(conversationId || "").trim();
    console.log(`[kb-tool] question="${q.slice(0, 80)}" call=${cid || "-"}`);

    // From here on, always answer 200 with found:false rather than an HTTP
    // error, so the agent speaks a graceful line instead of a tool failure.
    const soft = (answer) => res.json({ found: false, answer, sources: [], note: VOICE_NOTE });

    try {
      if (!q) return soft("No question was received. Ask the caller to repeat their question.");

      // Which user's KB? The one who placed this call. The Call row is saved
      // right after Edesy returns the id, so allow one short retry.
      let userId = null;
      if (cid) {
        for (let attempt = 0; attempt < 2 && !userId; attempt++) {
          if (attempt) await wait(700);
          const call = await CallModel.findOne({ executionId: cid }).select("userId").lean();
          userId = call?.userId || null;
        }
      }
      if (!userId) userId = getFallbackUserId() || null;
      if (!userId) {
        console.warn(`[kb-tool] no user found for call ${cid || "(none)"}`);
        return soft(NOT_FOUND_ANSWER);
      }

      const articles = await ArticleModel.find(
        { userId, isActive: true },
        { title: 1, content: 1 }
      ).lean();

      const result = searchKnowledge(q, articles);
      if (result.skipped) {
        console.warn(
          `[kb-tool] ${result.skipped} article(s) have no extracted text — run: npm run kb:reindex`
        );
      }
      if (!result.found) return soft(NOT_FOUND_ANSWER);

      console.log(`[kb-tool] answered from: ${result.sources.join(", ")}`);
      return res.json({ found: true, answer: result.answer, sources: result.sources, note: VOICE_NOTE });
    } catch (err) {
      console.error("[kb-tool] lookup failed:", err.message);
      return soft("The knowledge base could not be reached right now. Apologise briefly and offer a follow-up.");
    }
  };
}

export const knowledgeSearch = makeKnowledgeSearchHandler();
