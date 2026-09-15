// lib/cognidom.js
// Cognidom AI calling API integration.
// Docs: https://v2.cognidom.com/api
//
// IMPORTANT — how pathways fit in:
// Cognidom's public API does NOT accept a pathway/flow graph on the call
// request. The only call-shaping input it takes is `agentId` — the actual
// script/logic for that agent is configured inside the Cognidom dashboard
// against that agent. So "make the agent follow the pathway the user built"
// is implemented as: every saved Pathway (lib/models/Pathway.js) stores a
// `cognidomAgentId` pointing at the Cognidom agent that was configured (in
// their dashboard) to match that pathway's logic. At call time we resolve
// the pathway the user picked → its cognidomAgentId → pass that as agentId.
//
// We also forward pathwayId/pathwayName inside `meta`, since Cognidom logs
// and echoes `meta` back on the webhook (useful for your own records / CRM
// sync), even though it does not influence the agent's behavior.
//
// Required .env variables:
//   COGNIDOM_API_KEY   — your API key from Profile Settings on v2.cognidom.com
//   COGNIDOM_AGENT_ID  — fallback agent ID, used only if a call is started
//                         without a pathway (or the pathway has no agent set)

const BASE_URL  = "https://v2.cognidom.com/api";
const API_KEY   = process.env.COGNIDOM_API_KEY;
const AGENT_ID  = process.env.COGNIDOM_AGENT_ID;

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function cd(method, path, body) {
  if (!API_KEY) {
    throw Object.assign(
      new Error("COGNIDOM_API_KEY is not set in .env"),
      { status: 500 }
    );
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key":    API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.message || data?.error || `Cognidom API error ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }

  return data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start an outbound call.
 * @param {object} params
 * @param {string} params.phone         - destination phone number (E.164 format)
 * @param {string} params.contactName   - contact display name (optional)
 * @param {string} params.purpose       - call purpose / script hint (optional)
 * @param {string} params.agentId       - Cognidom agentId to use (required —
 *                                         normally resolved from the selected
 *                                         Pathway's cognidomAgentId)
 * @param {string} params.pathwayId     - your Pathway _id, forwarded in meta (optional)
 * @param {string} params.pathwayName   - your Pathway name, forwarded in meta (optional)
 * @param {string} params.campaignId    - forwarded in meta (optional)
 */
export async function startCall({ phone, contactName, purpose, agentId, pathwayId, pathwayName, campaignId }) {
  if (!phone) throw Object.assign(new Error("Phone number is required."), { status: 400 });

  const resolvedAgentId = agentId || AGENT_ID;
  if (!resolvedAgentId) {
    throw Object.assign(
      new Error("No Cognidom agentId available — select a pathway that has a Cognidom agent linked, or set COGNIDOM_AGENT_ID."),
      { status: 400 }
    );
  }

  const payload = {
    agentId:        resolvedAgentId,
    toPhoneNumber:  phone,
    meta: {
      contact_name: contactName  || "",
      purpose:      purpose      || "",
      pathway_id:   pathwayId    || "",
      pathway_name: pathwayName  || "",
      ...(campaignId ? { campaignId } : {}),
    },
  };

  console.log(`[cognidom] Starting call → ${phone} (agent ${resolvedAgentId})`);
  const data = await cd("POST", "/calls/single", payload);

  return {
    callId:      data.callId || "",
    executionId: data.executionId || "",
    status:      data.success ? "In Progress" : "Failed",
    message:     data.message || "",
    raw:         data,
  };
}

/**
 * Cognidom's public API does not expose GET/stop-by-id endpoints — call
 * results arrive asynchronously via the webhook (see webhookController.js /
 * handleCognidomWebhook). This is kept as a no-op so callController.js can
 * call it the same way it called rabbitcalls.getCallDetails without branching.
 */
export async function getCallDetails(_callId) {
  return null;
}

/**
 * No public "stop call" endpoint is documented for Cognidom. If Cognidom
 * adds one, wire it up here — for now this just marks intent locally.
 */
export async function stopCall(_callId) {
  return null;
}