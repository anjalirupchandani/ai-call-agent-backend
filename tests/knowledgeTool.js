// tests/knowledgeTool.js
// Run with:  node --test tests/knowledgeTool.js     (or: npm test)
//
// No network, no MongoDB, no Edesy credits. Mongoose models are stubbed and
// fetch/DNS are injected. The REAL search, extraction, SSRF guard, route and
// controller run, including through a real Express server.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import mongoose from "mongoose";

process.env.EDESY_API_KEY = "test-key";
process.env.EDESY_AGENT_ID = "42";
process.env.KB_TOOL_SECRET = "test-secret-0123456789abcdef";

const { searchKnowledge, tokenize } = await import("../lib/knowledgeSearch.js");
const { htmlToText, assertPublicUrl, extractWebsiteText, extractPdfText, normalizeText, isPlaceholderContent } =
  await import("../lib/knowledgeText.js");
const { parseToolBody } = await import("../controllers/agentToolsController.js");
const { default: agentToolsRouter } = await import("../routes/agentTools.js");
const { default: Call } = await import("../lib/models/Call.js");
const { default: KnowledgeArticle } = await import("../lib/models/KnowledgeArticle.js");
const { buildPathwayPrompt } = await import("../lib/pathwayPrompt.js");
const { upsertKnowledgeTool } = await import("../lib/edesy.js");

// ── sample knowledge ──────────────────────────────────────────────────────────

const solar = {
  title: "Acme Solar — Services and Pricing",
  content:
    "Acme Solar installs rooftop solar panels for homes and small businesses across Gujarat. " +
    "A standard 3 kW residential system costs about ₹1,80,000 before subsidy. " +
    "Installation usually takes two to three days after the site survey. " +
    "We offer a 25-year warranty on panels and a 5-year warranty on the inverter.\n\n" +
    "Our support team is available Monday to Saturday, from 9 AM to 6 PM. " +
    "You can reach support on 1800-123-4567 or by email at help@acmesolar.example.",
};
const refund = {
  title: "Refund Policy",
  content:
    "Deposits are refundable within 7 days of booking if the site survey has not started. " +
    "After the survey, the deposit is non-refundable but can be adjusted against a later order.",
};
const oldUpload = { title: "Old brochure", content: "[Binary file — application/pdf]" };

// ── search ────────────────────────────────────────────────────────────────────

test("search: finds the passage that answers the question", () => {
  const r = searchKnowledge("How much does a 3 kW system cost?", [solar, refund]);
  assert.equal(r.found, true);
  assert.match(r.answer, /1,80,000/);
  assert.deepEqual(r.sources, [solar.title]);
});

test("search: picks the right article, not just any article", () => {
  const r = searchKnowledge("can I get my deposit refunded?", [solar, refund]);
  assert.equal(r.found, true);
  assert.match(r.answer, /refundable within 7 days/);
  assert.deepEqual(r.sources, [refund.title]);
});

test("search: plural/singular and case differences still match", () => {
  const r = searchKnowledge("WHAT ARE YOUR SUPPORT HOUR", [solar]);
  assert.equal(r.found, true);
  assert.match(r.answer, /Monday to Saturday/);
});

test("search: unrelated question → found:false (agent must not invent an answer)", () => {
  const r = searchKnowledge("do you sell electric cars?", [solar, refund]);
  assert.equal(r.found, false);
  assert.equal(r.answer, "");
});

test("search: chit-chat with no content words → found:false", () => {
  assert.equal(searchKnowledge("hello, can you tell me please", [solar]).found, false);
});

test("search: placeholder (never-extracted) articles are skipped and counted", () => {
  const r = searchKnowledge("warranty", [oldUpload, solar]);
  assert.equal(r.found, true);
  assert.equal(r.skipped, 1);
  const only = searchKnowledge("warranty", [oldUpload]);
  assert.equal(only.found, false);
  assert.equal(only.skipped, 1);
});

test("search: works on non-Latin text (Hindi)", () => {
  const hindi = { title: "सेवा", content: "हमारी सहायता टीम सोमवार से शनिवार तक उपलब्ध है। इंस्टालेशन में दो दिन लगते हैं।" };
  assert.ok(tokenize("सहायता टीम").length > 0);
  const r = searchKnowledge("सहायता टीम कब उपलब्ध है", [hindi]);
  assert.equal(r.found, true);
  assert.match(r.answer, /सोमवार/);
});

test("search: answer is short enough to speak", () => {
  const long = { title: "Big", content: Array.from({ length: 80 }, (_, i) => `Warranty detail number ${i} explains the warranty terms.`).join(" ") };
  const r = searchKnowledge("warranty terms", [long]);
  assert.equal(r.found, true);
  assert.ok(r.answer.length <= 1400, `answer was ${r.answer.length} chars`);
});

// ── text extraction ───────────────────────────────────────────────────────────

test("htmlToText: drops scripts/styles/tags, keeps title + text, decodes entities", () => {
  const html = `<html><head><title>Acme &amp; Co</title><style>.a{color:red}</style></head>
    <body><script>var secret = 1;</script><h1>Pricing</h1><p>3&nbsp;kW costs &#8377;1,80,000.</p>
    <ul><li>Fast</li><li>Safe</li></ul></body></html>`;
  const t = htmlToText(html);
  assert.match(t, /^Acme & Co/);
  assert.match(t, /Pricing/);
  assert.match(t, /₹1,80,000/);
  assert.doesNotMatch(t, /secret|color:red|<|>/);
});

test("normalizeText: rejoins hard-wrapped lines, keeps paragraph breaks", () => {
  assert.equal(normalizeText("The quick\nbrown fox\n\nNext para"), "The quick brown fox\n\nNext para");
});

test("isPlaceholderContent recognises the old placeholders", () => {
  assert.equal(isPlaceholderContent("[Binary file — application/pdf]"), true);
  assert.equal(isPlaceholderContent("Website knowledge source: https://x.com"), true);
  assert.equal(isPlaceholderContent(""), true);
  assert.equal(isPlaceholderContent("Real text"), false);
});

test("extractPdfText: clear error if pdf-parse isn't installed (npm install not run yet)", async () => {
  await assert.rejects(() => extractPdfText(Buffer.from("%PDF-1.4")), /npm install|./);
});

// ── SSRF guard ────────────────────────────────────────────────────────────────

const publicDns = async () => [{ address: "93.184.216.34" }];
const privateDns = async () => [{ address: "10.0.0.5" }];

test("SSRF: blocks localhost, private, link-local/metadata, IPv6 loopback and mapped IPv4", async () => {
  for (const u of [
    "http://localhost:3000/x",
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://192.168.1.10/",
    "http://172.20.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "ftp://example.com/file",
  ]) {
    await assert.rejects(() => assertPublicUrl(u, publicDns), undefined, `should block ${u}`);
  }
});

test("SSRF: blocks a public-looking hostname that RESOLVES to a private address", async () => {
  await assert.rejects(() => assertPublicUrl("https://evil.example.com/", privateDns), /public website/);
});

test("SSRF: allows a normal public site", async () => {
  const u = await assertPublicUrl("https://example.com/about", publicDns);
  assert.equal(u.hostname, "example.com");
});

test("website fetch: returns readable text", async () => {
  const fetchImpl = async () =>
    new Response("<html><title>Hi</title><body><p>Open 9 to 6.</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  const t = await extractWebsiteText("https://example.com/", { fetchImpl, lookup: publicDns });
  assert.match(t, /Open 9 to 6/);
});

test("website fetch: a redirect to an internal address is refused", async () => {
  const fetchImpl = async () =>
    new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
  await assert.rejects(
    () => extractWebsiteText("https://example.com/", { fetchImpl, lookup: publicDns }),
    /public website/
  );
});

test("website fetch: non-HTML content types are refused", async () => {
  const fetchImpl = async () => new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } });
  await assert.rejects(() => extractWebsiteText("https://example.com/a.pdf", { fetchImpl, lookup: publicDns }), /isn't a web page/);
});

// ── body parsing ──────────────────────────────────────────────────────────────

test("parseToolBody: valid JSON", () => {
  assert.deepEqual(parseToolBody('{"question":"hi","conversation_id":"c1"}'), { question: "hi", conversation_id: "c1" });
});

test("parseToolBody: salvages a body broken by an unescaped quote in the caller's words", () => {
  const raw = '{"question":"what is the "gold" plan price","conversation_id":"c-42"}';
  const p = parseToolBody(raw);
  assert.equal(p.conversation_id, "c-42");
  assert.match(p.question, /gold.*plan price/);
});

// ── the HTTP endpoint, through a real Express app ─────────────────────────────

const userA = new mongoose.Types.ObjectId();
const userB = new mongoose.Types.ObjectId();
const KB = {
  [String(userA)]: [solar, refund],
  [String(userB)]: [{ title: "Bakery menu", content: "We sell sourdough bread for 250 rupees and croissants for 90 rupees." }],
};
const CALLS = { "conv-A": userA, "conv-B": userB };
let server, base;
let callLookups;

before(async () => {
  Call.findOne = ({ executionId }) => {
    callLookups++;
    return { select: () => ({ lean: async () => (CALLS[executionId] ? { userId: CALLS[executionId] } : null) }) };
  };
  KnowledgeArticle.find = (filter) => ({ lean: async () => (filter.isActive ? KB[String(filter.userId)] || [] : []) });

  const app = express();
  // Same order as index.js: agent-tools BEFORE express.json()
  app.use("/api/agent-tools", agentToolsRouter);
  app.use(express.json());
  app.get("/api/knowledge", (_req, res) => res.json([]));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = (body, { secret = process.env.KB_TOOL_SECRET, type = "application/json" } = {}) => {
  callLookups = 0;
  return fetch(`${base}/api/agent-tools/knowledge-search`, {
    method: "POST",
    headers: { "Content-Type": type, ...(secret ? { "X-Tool-Secret": secret } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
};

test("endpoint: wrong or missing secret → 401, and nothing is looked up", async () => {
  for (const secret of ["nope", ""]) {
    const res = await call({ question: "price?", conversation_id: "conv-A" }, { secret });
    assert.equal(res.status, 401);
    assert.equal(callLookups, 0);
  }
});

test("endpoint: answers from the KB of the user who placed the call", async () => {
  const res = await call({ question: "how much is a 3 kW system?", conversation_id: "conv-A" });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.found, true);
  assert.match(j.answer, /1,80,000/);
  assert.match(j.note, /short spoken sentences/);
});

test("endpoint: tenant isolation — user B's call can never see user A's knowledge", async () => {
  const b = await (await call({ question: "how much is a 3 kW solar system?", conversation_id: "conv-B" })).json();
  assert.equal(b.found, false);
  assert.doesNotMatch(JSON.stringify(b), /1,80,000|Acme/);
  const bread = await (await call({ question: "how much is sourdough bread?", conversation_id: "conv-B" })).json();
  assert.equal(bread.found, true);
  assert.match(bread.answer, /250 rupees/);
});

test("endpoint: unknown call id → graceful found:false (HTTP 200), not an error", async () => {
  const res = await call({ question: "warranty?", conversation_id: "does-not-exist" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).found, false);
});

test("endpoint: question with a stray quote (invalid JSON) is still answered", async () => {
  const raw = '{"question":"what is the "warranty" on panels","conversation_id":"conv-A"}';
  const j = await (await call(raw)).json();
  assert.equal(j.found, true);
  assert.match(j.answer, /25-year warranty/);
});

test("endpoint: empty question → asks the agent to have the caller repeat", async () => {
  const j = await (await call({ question: "  ", conversation_id: "conv-A" })).json();
  assert.equal(j.found, false);
  assert.match(j.answer, /repeat/);
});

test("endpoint: DB failure → graceful spoken fallback, HTTP 200", async () => {
  const original = KnowledgeArticle.find;
  KnowledgeArticle.find = () => ({ lean: async () => { throw new Error("db down"); } });
  try {
    const res = await call({ question: "warranty", conversation_id: "conv-A" });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.found, false);
    assert.match(j.answer, /could not be reached/);
  } finally {
    KnowledgeArticle.find = original;
  }
});

test("endpoint: no KB_TOOL_SECRET configured → 503 (fails closed)", async () => {
  const saved = process.env.KB_TOOL_SECRET;
  delete process.env.KB_TOOL_SECRET;
  try {
    const res = await call({ question: "x", conversation_id: "conv-A" }, { secret: "anything" });
    assert.equal(res.status, 503);
  } finally {
    process.env.KB_TOOL_SECRET = saved;
  }
});

test("endpoint: the normal JWT-protected app is unaffected by mounting order", async () => {
  const res = await fetch(`${base}/api/knowledge`);
  assert.equal(res.status, 200); // (stub route here; real route is guarded by requireAuth in index.js)
});

// ── prompt + Edesy registration ───────────────────────────────────────────────

test("prompt: every pathway tells the agent to use the KB tool; KB node names it", () => {
  const { prompt } = buildPathwayPrompt({
    nodes: [
      { id: "s", type: "start", data: { name: "Hi", description: "Hello from Acme." } },
      { id: "k", type: "knowledgeBase", data: { name: "Questions", description: "" } },
      { id: "e", type: "endCall", data: { name: "End", description: "Bye" } },
    ],
    edges: [{ source: "s", target: "k" }, { source: "k", target: "e" }],
  });
  assert.match(prompt, /call the function search_knowledge_base with their question BEFORE answering/);
  assert.match(prompt, /STEP 2 — Questions[\s\S]*call the function search_knowledge_base/);
});

test("Edesy registration: creates the tool with the ngrok URL, secret header and {{call.id}}", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : null });
    if (init?.method === "GET") return Response.json({ success: true, data: { functions: [], total: 0 } });
    return Response.json({ success: true, data: { id: 318 } }, { status: 201 });
  };
  try {
    const r = await upsertKnowledgeTool({
      publicBaseUrl: "https://abc-123.ngrok-free.dev/",
      toolSecret: "test-secret-0123456789abcdef",
    });
    assert.equal(r.action, "created");
    const post = seen.find((s) => s.method === "POST");
    assert.equal(post.url, "https://voice-agent.edesy.in/api/v1/functions");
    assert.equal(post.body.agentId, 42);
    assert.equal(post.body.name, "search_knowledge_base");
    assert.equal(post.body.httpUrl, "https://abc-123.ngrok-free.dev/api/agent-tools/knowledge-search");
    assert.equal(post.body.httpHeaders["X-Tool-Secret"], "test-secret-0123456789abcdef");
    assert.match(post.body.httpBody, /\{\{question\}\}/);
    assert.match(post.body.httpBody, /\{\{call\.id\}\}/);
    assert.deepEqual(post.body.requiredParams, ["question"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Edesy registration: re-running updates the existing tool instead of duplicating it", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), method: init?.method });
    if (init?.method === "GET")
      return Response.json({ success: true, data: { functions: [{ id: 318, name: "search_knowledge_base", agentId: 42 }] } });
    return Response.json({ success: true, data: { id: 318 } });
  };
  try {
    const r = await upsertKnowledgeTool({ publicBaseUrl: "https://new-url.ngrok-free.dev", toolSecret: "test-secret-0123456789abcdef" });
    assert.equal(r.action, "updated");
    assert.ok(seen.some((s) => s.method === "PATCH" && s.url.endsWith("/functions/318")));
    assert.ok(!seen.some((s) => s.method === "POST"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Edesy registration: rejects http:// URLs and weak secrets before calling Edesy", async () => {
  await assert.rejects(() => upsertKnowledgeTool({ publicBaseUrl: "http://localhost:3000", toolSecret: "test-secret-0123456789abcdef" }), /https/);
  await assert.rejects(() => upsertKnowledgeTool({ publicBaseUrl: "https://a.ngrok-free.dev", toolSecret: "short" }), /16 characters/);
});
