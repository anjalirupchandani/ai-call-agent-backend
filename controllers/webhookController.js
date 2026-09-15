// controllers/webhookController.js
// Handlers for misc top-level endpoints (health check) and the Cognidom
// post-call webhook. Agent / phone-number lookups were RabbitCalls-specific
// and have been dropped now that Cognidom is the active provider — Cognidom
// doesn't expose an equivalent public "list agents" endpoint; agents are
// managed in the Cognidom dashboard and linked to a Pathway manually
// (Pathway.cognidomAgentId).

import Call from "../lib/models/Call.js";

// GET /api/health
export function healthCheck(_req, res) {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    mode: "local (Cognidom for calling)",
  });
}

// POST /api/webhooks/cognidom
// Public endpoint (no auth — Cognidom calls this directly). Configure this
// URL in your agent settings on v2.cognidom.com. Payload shape per
// https://v2.cognidom.com/api:
//   { summary, call_id, agent_id, from_number, to_number, created_time,
//     end_time, call_duration_seconds, call_type, lead_score,
//     customer_intent, customer_information, status, goal_alignment,
//     reasoning, next_actions, emitted_at }
export async function handleCognidomWebhook(req, res) {
  try {
    const body = req.body || {};
    const callId = body.call_id;
    if (!callId) return res.status(400).json({ message: "Missing call_id" });

    const doc = await Call.findOne({ executionId: callId });
    // Always 200 — Cognidom has no call context to retry against on our side,
    // and a 4xx/5xx here would just make it retry a webhook we can't use.
    if (!doc) {
      console.warn(`[cognidom webhook] No local call found for call_id=${callId}`);
      return res.status(200).json({ received: true, matched: false });
    }

    doc.status         = mapStatus(body.status);
    doc.summary         = body.summary || doc.summary;
    doc.followUp        = Array.isArray(body.next_actions) ? body.next_actions.join("; ") : doc.followUp;
    doc.nextActions      = body.next_actions || doc.nextActions;
    doc.leadScore        = typeof body.lead_score === "number" ? body.lead_score : doc.leadScore;
    doc.customerIntent   = body.customer_intent || doc.customerIntent;
    doc.goalAlignment    = body.goal_alignment || doc.goalAlignment;
    if (body.customer_information?.name) doc.contact = body.customer_information.name;
    if (typeof body.call_duration_seconds === "number") {
      const m = Math.floor(body.call_duration_seconds / 60);
      const s = body.call_duration_seconds % 60;
      doc.duration = `${m}:${String(s).padStart(2, "0")}`;
    }
    if (body.reasoning) {
      doc.insights = [...new Set([...(doc.insights || []), body.reasoning])];
    }

    await doc.save();
    res.status(200).json({ received: true, matched: true });
  } catch (err) {
    console.error("[cognidom webhook] error:", err.message);
    // Still 200 so Cognidom doesn't hammer retries on a payload we can't process.
    res.status(200).json({ received: true, error: err.message });
  }
}

function mapStatus(s) {
  if (!s) return "Completed";
  const lower = String(s).toLowerCase();
  if (lower.includes("complet")) return "Completed";
  if (lower.includes("fail"))    return "Failed";
  if (lower.includes("cancel") || lower.includes("missed")) return "Cancelled";
  if (lower.includes("progress")) return "In Progress";
  return s;
}