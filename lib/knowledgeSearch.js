// lib/knowledgeSearch.js
// Finds the passages of a user's Knowledge Base that best match a caller's
// question, using plain keyword scoring (TF × IDF over the user's own passages).
//
// This is deliberately NOT RAG: no embeddings, no vector database, no LLM call.
// It just picks text; the voice agent's own LLM turns that text into speech.
// Pure functions only (no DB, no network) so they are easy to test.

import { isPlaceholderContent } from "./knowledgeText.js";

const PASSAGE_TARGET_CHARS = 550;
const MAX_ANSWER_CHARS = 1100; // keep spoken answers short (voice latency)
const MAX_PASSAGES = 3;

const STOPWORDS = new Set(
  (
    "a an the and or but if then so of to in on at by for with from as is are was were be been being am " +
    "do does did done have has had having i me my we our you your he she it its they them their this that " +
    "these those what which who whom whose when where why how can could would should will shall may might " +
    "must about into over under than too very just also not no yes please tell know want need get got give " +
    "let us any some there here"
  ).split(" ")
);

// Light plural stripping so "prices" matches "price". Works on any script.
function stem(t) {
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function tokenize(text) {
  const words = String(text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return words.map(stem).filter((w) => (w.length > 1 || /\p{N}/u.test(w)) && !STOPWORDS.has(w));
}

/** Split an article into ~550-char passages on sentence boundaries. */
export function splitPassages(content) {
  const sentences = String(content || "")
    .split(/(?<=[.!?।])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const passages = [];
  let buf = "";
  for (const s of sentences) {
    if (buf && buf.length + s.length + 1 > PASSAGE_TARGET_CHARS) {
      passages.push(buf);
      buf = "";
    }
    buf = buf ? `${buf} ${s}` : s;
  }
  if (buf) passages.push(buf);
  return passages;
}

/**
 * @param {string} question
 * @param {Array<{title: string, content: string}>} articles  the caller's owner's active articles
 * @returns {{found: boolean, answer: string, sources: string[], skipped: number}}
 *   `skipped` = articles that had no searchable text (old placeholder content).
 */
export function searchKnowledge(question, articles) {
  const terms = [...new Set(tokenize(question))];
  const searchable = [];
  let skipped = 0;

  for (const a of articles || []) {
    if (isPlaceholderContent(a.content)) {
      skipped++;
      continue;
    }
    const titleTokens = new Set(tokenize(a.title));
    for (const text of splitPassages(a.content)) {
      const tokens = tokenize(text);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      searchable.push({ title: a.title, text, tf, titleTokens });
    }
  }

  const none = { found: false, answer: "", sources: [], skipped };
  if (!terms.length || !searchable.length) return none;

  // Document frequency of each query term across all passages.
  const N = searchable.length;
  const idf = new Map(
    terms.map((t) => {
      const df = searchable.reduce((n, p) => n + (p.tf.has(t) ? 1 : 0), 0);
      return [t, Math.log(1 + N / (1 + df))];
    })
  );

  const minMatched = Math.max(1, Math.ceil(terms.length * 0.4));
  const scored = [];
  for (const p of searchable) {
    let score = 0;
    let matched = 0;
    for (const t of terms) {
      const n = p.tf.get(t) || 0;
      if (n) {
        matched++;
        score += idf.get(t) * (1 + Math.log(n));
      }
      if (p.titleTokens.has(t)) score += idf.get(t) * 0.5;
    }
    if (matched >= minMatched) scored.push({ p, score: score * (0.5 + matched / terms.length) });
  }
  if (!scored.length) return none;

  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  let used = 0;
  for (const { p } of scored) {
    if (picked.length >= MAX_PASSAGES) break;
    if (picked.length && used + p.text.length > MAX_ANSWER_CHARS) continue;
    picked.push(p);
    used += p.text.length;
  }

  return {
    found: true,
    answer: picked.map((p) => p.text).join("\n\n").slice(0, MAX_ANSWER_CHARS + 200),
    sources: [...new Set(picked.map((p) => p.title))],
    skipped,
  };
}
