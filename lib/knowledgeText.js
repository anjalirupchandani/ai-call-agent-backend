// lib/knowledgeText.js
// Turns an uploaded PDF or a website URL into plain text that is stored in the
// EXISTING KnowledgeArticle.content field.
//
// Why this exists: before this file, a PDF was saved as the placeholder string
// "[Binary file — application/pdf]" and a website as "Website knowledge source:
// <url>" — there was no real text for the agent to answer from.
//
// No embeddings, no vector DB, no LLM: this only produces text.

import dns from "node:dns/promises";
import net from "node:net";

export const MAX_CONTENT_CHARS = 300_000; // per article, keeps Mongo docs sane
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

// Placeholders written by the old code. The search skips articles that still
// contain only one of these (nothing to search).
const PLACEHOLDER_PREFIXES = ["[Binary file", "Website knowledge source:"];
export function isPlaceholderContent(content) {
  const c = String(content || "").trim();
  return !c || PLACEHOLDER_PREFIXES.some((p) => c.startsWith(p));
}

// ── Shared text clean-up ──────────────────────────────────────────────────────

/** Collapse hard-wrapped lines into paragraphs; keep blank lines as breaks. */
export function normalizeText(raw) {
  return String(raw || "")
    .replace(/\r/g, "")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n+/g, "\u0000")
    .replace(/\n/g, " ")
    .replace(/\u0000/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, MAX_CONTENT_CHARS);
}

// ── PDF ───────────────────────────────────────────────────────────────────────

/**
 * Extracts the text layer of a PDF. Scanned/image-only PDFs have no text layer
 * and will return "" (OCR is out of scope).
 *
 * pdf-parse is imported lazily from its inner file: the package's index.js runs
 * a debug routine that reads a missing test PDF when imported from ESM.
 */
export async function extractPdfText(buffer) {
  let pdfParse;
  try {
    ({ default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js"));
  } catch {
    throw new Error("PDF support isn't installed on the server. Run `npm install`.");
  }
  const result = await pdfParse(buffer);
  return normalizeText(result.text);
}

// ── HTML → text ───────────────────────────────────────────────────────────────

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

export function htmlToText(html) {
  let s = String(html || "");
  const title = (s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";

  s = s
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|header|footer|blockquote)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);

  const decodedTitle = decodeEntities(title).replace(/\s+/g, " ").trim();
  const body = normalizeText(s);
  return decodedTitle && !body.startsWith(decodedTitle) ? `${decodedTitle}\n\n${body}` : body;
}

function safeChar(code) {
  try {
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
  } catch {
    return " ";
  }
}

// ── SSRF guard ────────────────────────────────────────────────────────────────
// The server fetches a URL that a user typed in. Without this, a user could
// point it at localhost, the cloud metadata address, or your internal network.

function isPrivateIPv4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast / reserved
  );
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    // IPv4-mapped IPv6: dotted (::ffff:127.0.0.1) or the hex form Node's URL
    // parser produces (::ffff:7f00:1). Re-check the embedded IPv4 address.
    const dotted = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateIPv4(dotted[1]);
    const hex = l.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    // Loopback/unspecified and other "::"-prefixed forms, unique-local, link-local.
    return l.startsWith("::") || l.startsWith("fc") || l.startsWith("fd") || /^fe[89ab]/.test(l);
  }
  return true; // unknown format → refuse
}

/** Throws unless the URL is http(s) and every address it resolves to is public. */
export async function assertPublicUrl(urlString, lookup = dns.lookup) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    throw new Error("Enter a valid website URL.");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Website URL must use HTTP or HTTPS.");

  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("That address isn't a public website.");
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error("That address isn't a public website.");
  }
  return u;
}

// ── Website ───────────────────────────────────────────────────────────────────

async function readCapped(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetches ONE page (no crawling) and returns its readable text.
 * Redirects are followed manually so every hop is re-checked by the SSRF guard.
 * Note: pages that build their content with JavaScript return little or no text.
 */
export async function extractWebsiteText(url, { fetchImpl = fetch, lookup = dns.lookup } = {}) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current, lookup);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetchImpl(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KnowledgeBaseBot/1.0)", Accept: "text/html,text/plain" },
      });

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location"), current).href;
        continue;
      }
      if (!res.ok) throw new Error(`The website returned HTTP ${res.status}.`);

      const type = String(res.headers.get("content-type") || "").toLowerCase();
      if (type && !/text\/(html|plain)|application\/xhtml/.test(type)) {
        throw new Error("That URL isn't a web page (use a PDF upload for documents).");
      }
      const body = await readCapped(res, MAX_HTML_BYTES);
      return type.includes("text/plain") ? normalizeText(body) : htmlToText(body);
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("The website took too long to respond.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("The website redirected too many times.");
}
