// lib/rabbitcalls.js
// RabbitCalls REST API integration.
// Docs: https://app.rabbitcalls.com/api/public/v1
//
// Required .env variables:
//   RABBITCALLS_API_KEY    — your API key from the RabbitCalls dashboard
//   RABBITCALLS_AGENT_ID   — default agent ID to use for calls
//   RABBITCALLS_PHONE_ID   — default phone number ID to dial from

const BASE_URL   = "https://app.rabbitcalls.com/api/public/v1";
const API_KEY    = process.env.RABBITCALLS_API_KEY;
const AGENT_ID   = process.env.RABBITCALLS_AGENT_ID;
const PHONE_ID   = process.env.RABBITCALLS_PHONE_ID;

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function rc(method, path, body) {
  if (!API_KEY) {
    throw Object.assign(
      new Error("RABBITCALLS_API_KEY is not set in .env"),
      { status: 500 }
    );
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${API_KEY}`,
      "x-api-key":     API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.message || data?.error || `RabbitCalls API error ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }

  return data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start an outbound call.
 * @param {object} params
 * @param {string} params.phone        - destination phone number (E.164 format)
 * @param {string} params.contactName  - contact display name (optional)
 * @param {string} params.purpose      - call purpose / script hint (optional)
 * @param {string} params.agentId      - override default agent (optional)
 * @param {string} params.phoneId      - override default phone number (optional)
 */
export async function startCall({ phone, contactName, purpose, agentId, phoneId, knowledgeUrls = [] }) {
  if (!phone) throw Object.assign(new Error("Phone number is required."), { status: 400 });

  const payload = {
    phone_number: phone,
    agent_id:     agentId  || AGENT_ID,
    phone_id:     phoneId  || PHONE_ID,
    metadata: {
      contact_name: contactName || "",
      purpose:      purpose     || "",
      knowledge_urls: knowledgeUrls,
    },
  };

  console.log(`[rabbitcalls] Starting call → ${phone}`);
  const data = await rc("POST", "/calls/start", payload);

  return {
    callId:   data.call_id   || data.id || data.callId || "",
    callType: data.call_type || "phone",
    status:   data.status    || "In Progress",
    raw:      data,
  };
}

/**
 * Get details of an existing call.
 * @param {string} callId - the call_id returned by startCall
 */
export async function getCallDetails(callId) {
  if (!callId) return null;

  try {
    const data = await rc("GET", `/calls/${callId}`);

    const durationRaw = data.duration || 0;
    const m = Math.floor(durationRaw / 60);
    const s = durationRaw % 60;

    return {
      id:       callId,
      contact: {
        name:  data.metadata?.contact_name || data.contact_name || "Unknown",
        phone: data.phone_number           || "—",
        email: "—",
      },
      duration:   `${m}:${String(s).padStart(2, "0")}`,
      status:     mapStatus(data.status),
      agent:      data.agent_name || data.agent_id || "AI Agent",
      summary:    data.summary    || data.call_summary    || "",
      insights:   data.insights   || [],
      followUp:   data.follow_up  || data.followUp        || "",
      transcript: normalizeTranscript(data.transcript || data.messages || []),
      raw:        data,
    };
  } catch (err) {
    console.error(`[rabbitcalls] getCallDetails error: ${err.message}`);
    return null;
  }
}

/**
 * End / stop an active call.
 * @param {string} callId
 */
export async function stopCall(callId) {
  if (!callId) return null;

  try {
    const data = await rc("POST", `/calls/${callId}/stop`, {});
    console.log(`[rabbitcalls] Call stopped → ${callId}`);
    return { callId, status: "Completed", raw: data };
  } catch (err) {
    console.error(`[rabbitcalls] stopCall error: ${err.message}`);
    return null;
  }
}

/**
 * List available AI agents on your account.
 */
export async function listAgents() {
  try {
    const data = await rc("GET", "/agents");
    const agents = data?.agents || data?.data || data || [];
    return Array.isArray(agents) ? agents.map((a) => ({
      id:       a.id       || a.agent_id,
      name:     a.name     || a.agent_name || "Agent",
      language: a.language || "en",
      voice:    a.voice    || "",
    })) : [];
  } catch (err) {
    console.error(`[rabbitcalls] listAgents error: ${err.message}`);
    return [];
  }
}

/**
 * List phone numbers available on your account.
 */
export async function listPhoneNumbers() {
  try {
    const data = await rc("GET", "/phone-numbers");
    const phones = data?.phone_numbers || data?.data || data || [];
    return Array.isArray(phones) ? phones.map((p) => ({
      id:     p.id     || p.phone_id,
      number: p.number || p.phone_number || "",
      label:  p.label  || p.name         || "",
    })) : [];
  } catch (err) {
    console.error(`[rabbitcalls] listPhoneNumbers error: ${err.message}`);
    return [];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapStatus(s) {
  if (!s) return "Unknown";
  const lower = s.toLowerCase();
  if (lower.includes("progress") || lower.includes("active") || lower.includes("ringing")) return "In Progress";
  if (lower.includes("complet") || lower.includes("ended") || lower.includes("done"))     return "Completed";
  if (lower.includes("fail")    || lower.includes("error"))                                return "Failed";
  if (lower.includes("cancel")  || lower.includes("missed"))                               return "Cancelled";
  return s;
}

function normalizeTranscript(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => ({
    speaker: entry.speaker || entry.role || (entry.is_agent ? "ai" : "user"),
    text:    entry.text    || entry.content || entry.message || "",
    time:    entry.time    || entry.timestamp || "",
  }));
}
