// controllers/conversationController.js
// Real-time voice conversation "brain".
//
// The browser captures speech (Web Speech API), turns it into text and sends it
// here. We match that text against the user's Knowledge Base (Q&A pairs first,
// then document/website passages). With a Gemini key set, Gemini rephrases the
// matched text into a natural spoken answer (and /tts speaks it); without one
// we return the stored answer verbatim, or a polite "I don't have that
// information" line. Each turn is stored so the dashboard can
// show live history and the agent avoids repeating its greeting.

import crypto from "node:crypto";
import mongoose from "mongoose";
import Conversation from "../lib/models/Conversation.js";
import KnowledgeArticle from "../lib/models/KnowledgeArticle.js";
import { searchKnowledgeQA, searchDirectory } from "../lib/knowledgeSearch.js";
import {
  geminiReplyEnabled,
  geminiTtsEnabled,
  composeSpokenReply,
  synthesizeSpeech,
  NO_ANSWER,
} from "../lib/gemini.js";
import { createNotification } from "./notificationController.js";

// ── Localized lines ───────────────────────────────────────────────────────────
// Returned/sent in the language the conversation is in. The Q&A answers
// themselves are spoken exactly as the owner stored them.
const LINES = {
  en: {
    greeting: "Hello,  How may I help you today?",
    greetingAck: "Yes, how may I help you?",
    thanks: "You're welcome. Is there anything else I can help you with?",
    unknown: "I'm sorry, I don't have information about that. Could I help you with something else?",
    goodbye: "Thank you for calling. Have a great day.",
  },
  hi: {
    greeting: "नमस्ते, । मैं आपकी कैसे मदद कर सकता हूँ?",
    greetingAck: "जी, मैं आपकी कैसे मदद कर सकता हूँ?",
    thanks: "धन्यवाद। क्या मैं आपकी और कोई मदद कर सकता हूँ?",
    unknown: "माफ़ कीजिए, मेरे पास इसकी जानकारी नहीं है। क्या मैं आपकी किसी और बात में मदद कर सकता हूँ?",
    goodbye: "धन्यवाद, आपका दिन शुभ हो।",
  },
  gu: {
    greeting: "નમસ્તે, હું તમારી કેવી રીતે મદદ કરી શકું?",
    greetingAck: "જી, હું તમારી કેવી રીતે મદદ કરી શકું?",
    thanks: "આભાર. શું હું તમારી બીજી કોઈ મદદ કરી શકું?",
    unknown: "માફ કરજો, મારી પાસે આની માહિતી નથી. શું હું બીજી કોઈ રીતે મદદ કરી શકું?",
    goodbye: "આભાર, તમારો દિવસ સારો રહે.",
  },
};

const GREETING_TOKENS = {
  en: ["hi", "hello", "hey", "hiya", "greetings", "morning", "afternoon", "evening", "yo"],
  hi: ["नमस्ते", "नमस्कार", "हाय", "हैलो", "कैसे", "हाल"],
  gu: ["નમસ્તે", "નમસ્કાર", "કેમ", "હાય", "હેલો"],
};
const THANKS_TOKENS = {
  en: ["thanks", "thank", "thx", "appreciate", "cheers", "great", "awesome"],
  hi: ["धन्यवाद", "शुक्रिया", "आभार", "थैंक्स"],
  gu: ["આભાર", "ધન્યવાદ", "આભારી"],
};
const GOODBYE_TOKENS = {
  en: ["bye", "goodbye", "see", "later", "quit", "exit", "stop"],
  hi: ["अलविदा", "बाय", "चलता", "बंद"],
  gu: ["આવજો", "બાય", "બંધ"],
};

const VALID_LANGS = ["en", "hi", "gu"];

function linesFor(lang) {
  return LINES[VALID_LANGS.includes(lang) ? lang : "en"];
}

function looksLike(text, tokenSet) {
  const words = String(text || "").toLowerCase().split(/[\s,.!?।]+/).filter(Boolean);
  return words.some((w) => tokenSet.has(w));
}

function tokenSetOf(lang, dict) {
  const set = new Set(dict[lang] || []);
  // Always include English greeting/thanks tokens too, so "hello" works in any language.
  for (const t of dict.en || []) set.add(t);
  return set;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function newSessionId() {
  return crypto.randomBytes(12).toString("hex");
}

function toRow(doc) {
  return {
    id: doc._id,
    sessionId: doc.sessionId,
    language: doc.language,
    status: doc.status,
    messageCount: doc.messageCount,
    durationSeconds: doc.durationSeconds,
    startedAt: doc.startedAt,
    endedAt: doc.endedAt,
    createdAt: doc.createdAt,
    transcript: doc.transcript || [],
  };
}

async function loadActiveArticles(userId) {
  return KnowledgeArticle.find({ userId, isActive: { $ne: false } })
    .select("entryType title question answer variations content language")
    .lean();
}

// Decide the spoken reply for one user utterance, using the KB plus simple
// intent detection for greetings/thanks/goodbyes so the agent sounds natural
// and never repeats its opening greeting.
function decideReply(text, session, articles) {
  const lang = session.language || "en";
  const L = linesFor(lang);
  const cleaned = String(text || "").trim();

  if (!cleaned) return { reply: "", found: false, sources: [], confidence: 0, intent: "empty" };

  // Goodbye?
  if (looksLike(cleaned, tokenSetOf(lang, GOODBYE_TOKENS)) && cleaned.split(/\s+/).length <= 4) {
    return { reply: L.goodbye, found: false, sources: [], confidence: 0, intent: "goodbye" };
  }

  // ── Directory lookup (persons, departments, interviews) ───────────────────
  // This runs before the Q&A search so "I want to meet Kartik Trivedi" routes
  // to the structured directory entry rather than a generic Q&A.
  const dir = searchDirectory(cleaned, articles);
  if (dir.found) {
    return {
      reply: dir.answer,
      found: true,
      sources: [dir.matchedName],
      confidence: 1,
      intent: dir.intent,
    };
  }

  // ── Knowledge base Q&A lookup ─────────────────────────────────────────────
  const result = searchKnowledgeQA(cleaned, articles, { language: lang });
  if (result.found && result.answer) {
    return { reply: result.answer, found: true, sources: result.sources, confidence: result.confidence, intent: "qa" };
  }

  // No match — small-talk fallbacks so the agent sounds human, not robotic.
  if (looksLike(cleaned, tokenSetOf(lang, THANKS_TOKENS))) {
    return { reply: L.thanks, found: false, sources: [], confidence: 0, intent: "thanks" };
  }
  if (looksLike(cleaned, tokenSetOf(lang, GREETING_TOKENS))) {
    return { reply: L.greetingAck, found: false, sources: [], confidence: 0, intent: "greeting" };
  }

  return { reply: L.unknown, found: false, sources: [], confidence: 0, intent: "unknown" };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// POST /api/conversation/start
// Body: { language? }  →  { sessionId, language, greeting }
export async function startConversation(req, res) {
  try {
    const language = VALID_LANGS.includes(req.body?.language) ? req.body.language : "en";
    const sessionId = newSessionId();

    const doc = await Conversation.create({
      sessionId,
      userId: req.userId,
      language,
      status: "Active",
      startedAt: new Date(),
      messageCount: 0,
      transcript: [],
    });

    res.status(201).json({
      sessionId,
      language,
      greeting: linesFor(language).greeting,
      conversationId: doc._id,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/conversation/message
// Body: { sessionId, text, language? }  →  { reply, found, sources, confidence, intent }
export async function sendMessage(req, res) {
  try {
    const { sessionId, text, language } = req.body || {};
    if (!sessionId) return res.status(400).json({ message: "sessionId is required" });
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ message: "text is required" });
    }

    const doc = await Conversation.findOne({ sessionId, userId: req.userId });
    if (!doc) return res.status(404).json({ message: "Conversation not found" });

    // Allow switching language mid-conversation.
    if (VALID_LANGS.includes(language)) doc.language = language;
    if (doc.status === "Completed") {
      doc.status = "Active";
      doc.endedAt = null;
    }

    const articles = await loadActiveArticles(req.userId);
    const decision = decideReply(text, doc, articles);

    // Optional: let Gemini turn the matched Knowledge Base text into a short,
    // natural spoken answer. It may only use that text. If Gemini is off, fails,
    // or times out we silently keep the verbatim KB answer.
    if (decision.intent === "qa" && geminiReplyEnabled()) {
      const history = (doc.transcript || []).slice(-6).map((t) => ({ speaker: t.speaker, text: t.text }));
      const spoken = await composeSpokenReply({
        question: text,
        knowledge: decision.reply,
        language: doc.language,
        history,
      });
      if (spoken === NO_ANSWER) {
        decision.reply = linesFor(doc.language).unknown;
        decision.found = false;
        decision.sources = [];
        decision.confidence = 0;
        decision.intent = "unknown";
      } else if (spoken) {
        decision.reply = spoken;
        decision.intent = "qa-ai";
      }
    }

    doc.transcript.push({ speaker: "user", text: text.trim().slice(0, 4000) });
    if (decision.reply) {
      doc.transcript.push({ speaker: "ai", text: decision.reply.slice(0, 4000) });
    }
    doc.messageCount = (doc.messageCount || 0) + 1;
    await doc.save();

    res.json({
      reply: decision.reply,
      found: decision.found,
      sources: decision.sources,
      confidence: decision.confidence,
      intent: decision.intent,
      language: doc.language,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/conversation/tts
// Body: { text }  ->  audio file (WAV) spoken by Gemini. The browser falls back
// to its own voice when this returns an error, so failures here are non-fatal.
export async function speakText(req, res) {
  try {
    if (!geminiTtsEnabled()) {
      return res.status(503).json({ message: "Gemini voice is not configured (set GEMINI_API_KEY)." });
    }
    const text = String(req.body?.text || "").trim().slice(0, 1000);
    if (!text) return res.status(400).json({ message: "text is required" });

    const { buffer, mime } = await synthesizeSpeech(text);
    res.set({ "Content-Type": mime, "Cache-Control": "no-store" });
    res.send(buffer);
  } catch (err) {
    console.error("TTS error:", err.message);
    res.status(502).json({ message: err.message || "Voice generation failed." });
  }
}

// POST /api/conversation/end
// Body: { sessionId }  →  { ended: true, durationSeconds }
export async function endConversation(req, res) {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ message: "sessionId is required" });

    const doc = await Conversation.findOne({ sessionId, userId: req.userId });
    if (!doc) return res.status(404).json({ message: "Conversation not found" });

    if (doc.status !== "Completed") {
      doc.status = "Completed";
      doc.endedAt = new Date();
      const start = doc.startedAt ? new Date(doc.startedAt).getTime() : new Date(doc.createdAt).getTime();
      doc.durationSeconds = Math.max(0, Math.round((Date.now() - start) / 1000));
      await doc.save();
    }

    res.json({ ended: true, durationSeconds: doc.durationSeconds });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/conversation
export async function listConversations(req, res) {
  try {
    const docs = await Conversation.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(docs.map(toRow));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/conversation/:sessionId
export async function getConversation(req, res) {
  try {
    const doc = await Conversation.findOne({ sessionId: req.params.sessionId, userId: req.userId });
    if (!doc) {
      // Fallback to MongoDB _id for convenience.
      if (mongoose.Types.ObjectId.isValid(req.params.sessionId)) {
        const byId = await Conversation.findOne({ _id: req.params.sessionId, userId: req.userId });
        if (byId) return res.json(toRow(byId));
      }
      return res.status(404).json({ message: "Conversation not found" });
    }
    res.json(toRow(doc));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// DELETE /api/conversation/:sessionId
export async function deleteConversation(req, res) {
  try {
    const r = await Conversation.deleteOne({ sessionId: req.params.sessionId, userId: req.userId });
    if (r.deletedCount === 0 && mongoose.Types.ObjectId.isValid(req.params.sessionId)) {
      const r2 = await Conversation.deleteOne({ _id: req.params.sessionId, userId: req.userId });
      if (r2.deletedCount) return res.json({ message: "Conversation removed." });
    }
    if (r.deletedCount === 0) return res.status(404).json({ message: "Conversation not found" });
    res.json({ message: "Conversation removed." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// Exported for the dashboard controller.
export async function getConversationsForUser(userId) {
  return Conversation.find({ userId }).sort({ createdAt: -1 });
}