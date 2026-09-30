// lib/edesy.js
// Edesy Voice Agent API integration — SERVER-SIDE ONLY.
// Docs: https://edesy.in/docs/voice-agent/api/trigger-call
//
// Required backend .env variables:
//   EDESY_API_KEY       — API key (Edesy dashboard → Settings → API Keys)
//   EDESY_AGENT_ID      — numeric ID of the Edesy voice agent that places the calls
//   EDESY_WORKSPACE_ID  — optional and currently UNUSED: per the Edesy docs the
//                         workspace is identified automatically from the API key,
//                         so it is never sent with a request.
//
// The API key is read only in this file and sent only to voice-agent.edesy.in.
// It is never logged, never returned to the browser and never stored in MongoDB.
//
// Statuses: Edesy documents only `initiated`, `in-progress` and `completed`
// (plus `failed` as a list filter). We map those onto the status vocabulary the
// rest of this app already uses: "In Progress" | "Completed" | "Failed" |
// "Missed" | "Cancelled". We do not invent "ringing" / "busy" states, because
// Edesy does not report them.

import {
  KNOWLEDGE_TOOL_NAME,
  KNOWLEDGE_TOOL_DESCRIPTION,
  KNOWLEDGE_TOOL_PATH,
} from "./knowledgeTool.js";

const BASE_URL = "https://voice-agent.edesy.in/api/v1";
const REQUEST_TIMEOUT_MS = 30_000;

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * An error whose `message` is safe to show to the end user.
 * `status` is the HTTP status WE send to our own frontend.
 * NOTE: never use 401 here — the frontend's request() helper treats any 401 as
 * "your login expired" and clears the JWT, which would log the user out just
 * because the Edesy key is wrong.
 */
export class EdesyError extends Error {
  constructor(message, { status = 502, code = "EDESY_ERROR" } = {}) {
    super(message);
    this.name = "EdesyError";
    this.status = status;
    this.code = code;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

function getApiKey() {
  const apiKey = process.env.EDESY_API_KEY?.trim();
  if (!apiKey) {
    console.error("[edesy] EDESY_API_KEY is missing from the backend .env");
    throw new EdesyError(
      "Edesy calling isn't configured on the server yet. Add the Edesy credentials to the backend .env file and restart the server.",
      { status: 500, code: "NOT_CONFIGURED" }
    );
  }
  return apiKey;
}

function getAgentId() {
  const raw = process.env.EDESY_AGENT_ID?.trim();
  if (!raw) {
    console.error("[edesy] EDESY_AGENT_ID is missing from the backend .env");
    throw new EdesyError(
      "Edesy calling isn't configured on the server yet. Add the Edesy credentials to the backend .env file and restart the server.",
      { status: 500, code: "NOT_CONFIGURED" }
    );
  }
  const agentId = Number(raw);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    console.error("[edesy] EDESY_AGENT_ID is not a positive whole number");
    throw new EdesyError(
      "The Edesy Agent ID configured on the server is invalid. It must be the numeric ID shown on the Edesy Agents page.",
      { status: 500, code: "INVALID_AGENT_ID" }
    );
  }
  return agentId;
}

export function isEdesyConfigured() {
  return Boolean(process.env.EDESY_API_KEY?.trim() && process.env.EDESY_AGENT_ID?.trim());
}

// ── Phone numbers ─────────────────────────────────────────────────────────────

/**
 * Validates and normalizes a phone number to E.164 (e.g. +919876543210).
 * Bare 10-digit Indian mobile numbers (start 6–9) get +91 added.
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
export function normalizePhoneNumber(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "Phone number is required." };
  }

  let s = raw.trim().replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;

  if (!s.startsWith("+")) {
    if (/^[6-9]\d{9}$/.test(s)) s = `+91${s}`;
    else if (/^0[6-9]\d{9}$/.test(s)) s = `+91${s.slice(1)}`;
    else if (/^91[6-9]\d{9}$/.test(s)) s = `+${s}`;
    else {
      return {
        ok: false,
        error: "Include the country code, e.g. +919876543210 for India.",
      };
    }
  }

  if (!/^\+[1-9]\d{7,14}$/.test(s)) {
    return {
      ok: false,
      error: "That doesn't look like a valid phone number. Use international format, e.g. +919876543210.",
    };
  }
  if (s.startsWith("+91") && !/^\+91\d{10}$/.test(s)) {
    return {
      ok: false,
      error: "Indian numbers need exactly 10 digits after +91.",
    };
  }
  return { ok: true, value: s };
}

export function maskPhone(phone) {
  if (!phone || phone.length < 7) return "***";
  return `${phone.slice(0, 3)}${"*".repeat(phone.length - 7)}${phone.slice(-4)}`;
}

// ── Status mapping ────────────────────────────────────────────────────────────

const FINAL_STATUSES = new Set(["Completed", "Failed", "Missed", "Cancelled"]);

export function isFinalStatus(status) {
  return FINAL_STATUSES.has(status);
}

/**
 * Maps Edesy's status (+ optional disposition) to this app's status labels.
 * Unknown values are treated as still in progress; the polling side has a hard
 * cap so an unrecognised status can never poll forever.
 */
export function mapEdesyStatus(providerStatus, disposition) {
  const s = String(providerStatus || "").toLowerCase().replace(/[_\s]/g, "-");
  const d = String(disposition || "").toUpperCase();

  if (["failed", "failure", "error"].includes(s)) return "Failed";
  if (["cancelled", "canceled"].includes(s)) return "Cancelled";
  if (["busy", "no-answer", "noanswer", "missed"].includes(s)) return "Missed";
  if (["completed", "complete", "ended", "done"].includes(s)) {
    return d === "NO_ANSWER" ? "Missed" : "Completed";
  }
  return "In Progress"; // initiated, in-progress, queued, ...
}

function formatDuration(totalSeconds) {
  if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return null;
  }
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Edesy transcript turns are { role: "agent" | "user", text, timestamp }.
// The frontend TranscriptPanel expects { speaker: "ai" | "user", text }.
function mapTranscript(turns) {
  if (!Array.isArray(turns)) return [];
  return turns
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .map((t) => ({
      speaker: ["agent", "assistant", "ai", "bot"].includes(String(t.role).toLowerCase())
        ? "ai"
        : "user",
      text: t.text,
      ...(t.timestamp ? { timestamp: t.timestamp } : {}),
    }));
}

function normalizeCallDetails(d) {
  const providerStatus = String(d.status || "");
  const disposition = d.disposition || "";
  const status = mapEdesyStatus(providerStatus, disposition);
  return {
    conversationId: d.conversationId || "",
    callSid: d.callSid || "",
    providerStatus,
    status,
    isFinal: isFinalStatus(status),
    disposition,
    durationSeconds: typeof d.duration === "number" ? d.duration : null,
    duration: formatDuration(d.duration),
    summary: typeof d.summary === "string" ? d.summary : "",
    recordingUrl: typeof d.recordingUrl === "string" ? d.recordingUrl : "",
    transcript: mapTranscript(d.transcript),
    startTime: d.startTime || null,
    endTime: d.endTime || null,
  };
}

// ── Transcript normalization ──────────────────────────────────────────────────

/**
 * Normalizes raw transcript turns from Edesy's dedicated transcript endpoint.
 * Edesy returns turns as { role: "agent" | "user", text, timestamp }.
 * Maps to the frontend's expected { speaker: "ai" | "user", text, timestamp }.
 */
function normalizeTranscriptTurns(turns) {
  if (!Array.isArray(turns)) return [];
  return turns
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .map((t) => ({
      speaker: ["agent", "assistant", "ai", "bot"].includes(String(t.role).toLowerCase())
        ? "ai"
        : "user",
      text: t.text,
      ...(t.timestamp ? { timestamp: t.timestamp } : {}),
    }));
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function mapHttpError(httpStatus, data, context) {
  const code = typeof data?.code === "string" ? data.code : "";
  const upstream = typeof data?.error === "string" ? data.error.slice(0, 200) : "";
  // Log Edesy's own error text for debugging. Never log headers or the key.
  console.error(`[edesy] API error http=${httpStatus} code=${code || "-"} msg=${upstream || "-"}`);

  if (httpStatus === 402 || /insufficient|credit/i.test(upstream)) {
    return new EdesyError(
      "Your Edesy calling credits are insufficient. Please add credits before making another call.",
      { status: 402, code: "INSUFFICIENT_CREDITS" }
    );
  }
  if (
    httpStatus === 401 ||
    ["MISSING_API_KEY", "INVALID_KEY_FORMAT", "INVALID_API_KEY"].includes(code)
  ) {
    return new EdesyError(
      "Edesy rejected the server's API key. It may be wrong, expired or revoked — check the Edesy key configured on the server.",
      { status: 502, code: "EDESY_AUTH" }
    );
  }
  if (httpStatus === 403) {
    return new EdesyError(
      "Edesy denied this request. Check that the API key has access to this agent.",
      { status: 502, code: "EDESY_FORBIDDEN" }
    );
  }
  if (code === "MISSING_AGENT_ID" || (httpStatus === 404 && context === "place")) {
    return new EdesyError(
      "Edesy couldn't find the configured agent. Check the Edesy Agent ID configured on the server.",
      { status: 502, code: "INVALID_AGENT" }
    );
  }
  if (httpStatus === 404) {
    return new EdesyError("Edesy has no record of that call.", { status: 404, code: "CALL_NOT_FOUND" });
  }
  if (httpStatus === 429) {
    return new EdesyError("Edesy is rate-limiting requests. Wait a moment and try again.", {
      status: 429,
      code: "RATE_LIMITED",
    });
  }
  if (httpStatus === 400) {
    return new EdesyError(
      upstream
        ? `Edesy couldn't place the call: ${upstream}`
        : "Edesy rejected the call request. Check the phone number and try again.",
      { status: 400, code: code || "EDESY_BAD_REQUEST" }
    );
  }
  if (httpStatus >= 500) {
    return new EdesyError("Edesy is having problems right now. Please try again shortly.", {
      status: 502,
      code: "EDESY_DOWN",
    });
  }
  return new EdesyError(upstream ? `Edesy error: ${upstream}` : `Edesy returned an error (${httpStatus}).`, {
    status: 502,
    code: code || "EDESY_ERROR",
  });
}

async function edesyFetch(method, path, { body, query, context } = {}) {
  const apiKey = getApiKey();

  let url = `${BASE_URL}${path}`;
  if (query) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    if (qs) url += `?${qs}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  let text;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    const timedOut = err?.name === "AbortError";
    console.error(`[edesy] ${method} ${path} failed:`, timedOut ? "timeout" : err?.cause?.code || err?.message);
    // For a POST we cannot know whether Edesy dialled before the connection
    // dropped, so tell the user to check before clicking again (credits!).
    const suffix =
      method === "POST"
        ? " The call may or may not have started — check Call History or the Edesy dashboard before trying again."
        : "";
    throw new EdesyError(
      (timedOut
        ? "Edesy took too long to respond."
        : "Couldn't reach Edesy. Check your internet connection.") + suffix,
      { status: 504, code: "NETWORK" }
    );
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON body — handled below */
  }

  if (!res.ok || data?.success === false) {
    throw mapHttpError(res.status, data, context);
  }
  if (!data || typeof data !== "object") {
    throw new EdesyError("Edesy returned an unexpected response.", { status: 502, code: "BAD_RESPONSE" });
  }
  return data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Place ONE outbound call. This is never retried automatically — a retry could
 * dial (and bill) the customer twice.
 *
 * @param {string} phoneNumber  E.164 number (use normalizePhoneNumber first)
 * @param {object} variables    dynamic variables injected into the agent prompt
 * @param {object} [options]
 * @param {object} [options.metadata]  custom metadata attached to the call record
 * @returns {Promise<{conversationId: string, callSid: string, status: string, agentId: number}>}
 */
export async function placeOutboundCall(phoneNumber, variables = {}, { metadata } = {}) {
  const agentId = getAgentId();

  const body = {
    agentId,
    phoneNumber,
    ...(variables && Object.keys(variables).length ? { variables } : {}),
    ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
  };

  console.log(`[edesy] Placing call → ${maskPhone(phoneNumber)} (agent ${agentId})`);
  const res = await edesyFetch("POST", "/calls", { body, context: "place" });

  // Documented shape: { success, data: { conversationId, callSid, status } }
  const d = res.data && typeof res.data === "object" ? res.data : res;
  if (!d.conversationId) {
    console.error("[edesy] Success response had no conversationId");
    throw new EdesyError(
      "Edesy accepted the request but didn't return a call ID. The call may have started — check the Edesy dashboard before trying again.",
      { status: 502, code: "BAD_RESPONSE" }
    );
  }

  return {
    conversationId: String(d.conversationId),
    callSid: d.callSid ? String(d.callSid) : "",
    status: d.status || "initiated",
    agentId,
  };
}

/**
 * Current state of a call: status, duration, summary, transcript, recording.
 * (summary/transcript are only populated after the call ends and Edesy finishes
 * post-call processing, so they can be empty for a few seconds.)
 */
export async function getCallStatus(conversationId) {
  if (typeof conversationId !== "string" || !conversationId.trim() || conversationId.length > 100) {
    throw new EdesyError("Invalid call ID.", { status: 400, code: "INVALID_CALL_ID" });
  }
  const res = await edesyFetch("GET", `/calls/${encodeURIComponent(conversationId.trim())}`, {
    context: "read",
  });
  return normalizeCallDetails(res.data && typeof res.data === "object" ? res.data : res);
}

/**
 * Transcript turns as [{ speaker: "ai" | "user", text, timestamp }].
 *
 * Uses the dedicated transcript endpoint:
 *   GET /api/v1/calls/{conversationId}/transcript
 *
 * Edesy documents this as a lighter alternative to the full call-detail
 * endpoint when only the conversation text is needed [citation:1].
 *
 * Response shape: { success, data: { turns: [...], fullText: "..." } }
 * Each turn: { role: "agent" | "user", text: "...", timestamp: "ISO8601" }
 */
export async function getCallTranscript(conversationId) {
  if (typeof conversationId !== "string" || !conversationId.trim() || conversationId.length > 100) {
    throw new EdesyError("Invalid call ID.", { status: 400, code: "INVALID_CALL_ID" });
  }

  const res = await edesyFetch(
    "GET",
    `/calls/${encodeURIComponent(conversationId.trim())}/transcript`,
    { context: "read" }
  );

  const d = res.data && typeof res.data === "object" ? res.data : res;
  const turns = Array.isArray(d.turns) ? d.turns : Array.isArray(d.transcript) ? d.transcript : [];

  return normalizeTranscriptTurns(turns);
}

/**
 * Ends an active call.
 *
 * Uses the documented hangup endpoint:
 *   POST /api/v1/calls/{conversationId}/end
 *
 * Edesy documents this as the way to terminate a call [citation:2].
 *
 * GUARD: Before attempting the hangup, this function fetches the current
 * call status. If the call is already in a final state (Completed, Failed,
 * Missed, Cancelled), the hangup is skipped and a clear error is thrown.
 * This prevents falsely marking an already-ended call as "ended by user".
 *
 * @returns {Promise<{success: true, conversationId: string}>}
 */
export async function endCall(conversationId) {
  if (typeof conversationId !== "string" || !conversationId.trim() || conversationId.length > 100) {
    throw new EdesyError("Invalid call ID.", { status: 400, code: "INVALID_CALL_ID" });
  }

  // Check current status to avoid hanging up an already-finalised call.
  const current = await getCallStatus(conversationId);
  if (current.isFinal) {
    throw new EdesyError(
      `This call is already ${current.status.toLowerCase()} and cannot be ended again.`,
      { status: 409, code: "CALL_ALREADY_ENDED" }
    );
  }

  const res = await edesyFetch(
    "POST",
    `/calls/${encodeURIComponent(conversationId.trim())}/end`,
    { context: "end" }
  );

  return {
    success: true,
    conversationId,
  };
}

/**
 * Recent calls for the workspace (Edesy paginates: limit ≤ 100).
 * Not wired to a route — call history in the UI comes from MongoDB.
 */
export async function getCallHistory({ agentId, status, phoneNumber, startDate, endDate, limit = 50, offset = 0 } = {}) {
  const res = await edesyFetch("GET", "/calls", {
    query: { agentId, status, phoneNumber, startDate, endDate, limit, offset },
    context: "read",
  });
  const d = res.data && typeof res.data === "object" ? res.data : res;
  return {
    calls: Array.isArray(d.calls) ? d.calls : [],
    total: typeof d.total === "number" ? d.total : 0,
    limit: d.limit ?? limit,
    offset: d.offset ?? offset,
  };
}

/**
 * Writes the pathway's prompt (and greeting) onto the Edesy agent so the next
 * call follows the flowchart.
 *
 *   PATCH /api/v1/agents/{id}   body: { prompt, greetingMessage }
 *
 * Per the Edesy docs a 200 means the change applies to the NEXT call. Edesy
 * keeps a restorable prompt-version history, so the previous prompt can be
 * brought back from the Edesy dashboard.
 *
 * Needs an API key with the `agents:write` scope.
 * Resolves only after Edesy confirms the update; throws EdesyError otherwise.
 * @returns {Promise<{agentId: number}>}
 */
export async function updateAgentPrompt({ prompt, greetingMessage }) {
  const agentId = getAgentId();
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new EdesyError("The pathway produced an empty prompt.", {
      status: 400,
      code: "EMPTY_PROMPT",
    });
  }

  const body = { prompt };
  if (typeof greetingMessage === "string" && greetingMessage.trim()) {
    body.greetingMessage = greetingMessage.trim().slice(0, 500);
  }

  try {
    // context "place" reuses the "agent not found" wording for a 404.
    await edesyFetch("PATCH", `/agents/${agentId}`, { body, context: "place" });
  } catch (err) {
    if (err instanceof EdesyError && err.code === "EDESY_FORBIDDEN") {
      throw new EdesyError(
        "Your Edesy API key can't edit agents. Create a key with the agents:write scope (Edesy dashboard → Settings → API Keys) and update EDESY_API_KEY.",
        { status: 502, code: "EDESY_SCOPE" }
      );
    }
    throw err;
  }
  console.log(`[edesy] Pathway prompt applied to agent ${agentId}`);
  return { agentId };
}


/**
 * Creates (or updates) the "search_knowledge_base" tool on the Edesy agent so the
 * voice agent can look up answers in this project's Knowledge Base mid-call.
 *
 *   POST /api/v1/functions   (or PATCH /api/v1/functions/{id} if it already exists)
 *
 * Safe to run repeatedly — e.g. whenever the ngrok URL changes. Per the Edesy
 * docs a new/updated tool is visible to live calls immediately.
 * Needs an API key with the `functions:write` scope.
 *
 * @param {{publicBaseUrl: string, toolSecret: string}} opts
 *   publicBaseUrl  the public https URL of this backend (the ngrok URL)
 *   toolSecret     value Edesy sends in X-Tool-Secret (must equal KB_TOOL_SECRET)
 * @returns {Promise<{id: number|string, action: "created"|"updated", url: string}>}
 */
export async function upsertKnowledgeTool({ publicBaseUrl, toolSecret } = {}) {
  const agentId = getAgentId();

  const base = String(publicBaseUrl || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+/.test(base)) {
    throw new EdesyError(
      "PUBLIC_BASE_URL must be the public https URL of this backend (your ngrok URL).",
      { status: 400, code: "BAD_PUBLIC_URL" }
    );
  }
  if (typeof toolSecret !== "string" || toolSecret.trim().length < 16) {
    throw new EdesyError("KB_TOOL_SECRET must be set to a random string of at least 16 characters.", {
      status: 400,
      code: "BAD_TOOL_SECRET",
    });
  }

  const url = `${base}${KNOWLEDGE_TOOL_PATH}`;
  const definition = {
    name: KNOWLEDGE_TOOL_NAME,
    description: KNOWLEDGE_TOOL_DESCRIPTION,
    parametersSchema: {
      question: {
        type: "string",
        description: "The caller's question, in their own words (e.g. 'what are your opening hours')",
      },
    },
    requiredParams: ["question"],
    httpMethod: "POST",
    httpUrl: url,
    httpHeaders: {
      "Content-Type": "application/json",
      "X-Tool-Secret": toolSecret.trim(),
      // Harmless elsewhere; stops ngrok's free-tier browser interstitial.
      "ngrok-skip-browser-warning": "true",
    },
    // A JSON *string* (Edesy substitutes the placeholders at call time).
    // {{call.id}} is the conversationId we already store as Call.executionId,
    // which is how the endpoint knows whose Knowledge Base to search.
    httpBody: '{"question":"{{question}}","conversation_id":"{{call.id}}"}',
    isActive: true,
  };

  try {
    const list = await edesyFetch("GET", "/functions", { query: { agentId, limit: 100 }, context: "read" });
    const d = list.data && typeof list.data === "object" ? list.data : list;
    const existing = (Array.isArray(d.functions) ? d.functions : []).find(
      (f) => f?.name === KNOWLEDGE_TOOL_NAME && (f.agentId == null || Number(f.agentId) === agentId)
    );

    if (existing) {
      await edesyFetch("PATCH", `/functions/${encodeURIComponent(existing.id)}`, {
        body: definition,
        context: "place",
      });
      console.log(`[edesy] Knowledge tool ${existing.id} updated → ${url}`);
      return { id: existing.id, action: "updated", url };
    }

    const created = await edesyFetch("POST", "/functions", {
      body: { agentId, ...definition },
      context: "place",
    });
    const c = created.data && typeof created.data === "object" ? created.data : created;
    console.log(`[edesy] Knowledge tool ${c.id} created → ${url}`);
    return { id: c.id, action: "created", url };
  } catch (err) {
    if (err instanceof EdesyError && err.code === "EDESY_FORBIDDEN") {
      throw new EdesyError(
        "Your Edesy API key can't manage tools. Create a key with the functions:write scope (Edesy dashboard → Settings → API Keys) and update EDESY_API_KEY.",
        { status: 502, code: "EDESY_SCOPE" }
      );
    }
    throw err;
  }
}
