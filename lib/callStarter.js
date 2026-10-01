// lib/callStarter.js
// ONE place that places a real outbound Edesy call. Used by BOTH:
//   • controllers/callController.js  (Start Call button)
//   • lib/scheduler.js               (appointment time reached)
//
//   (optional) pathway → update the shared Edesy agent → place the call → save Call
//
// If preparing the agent fails, NO call is placed.
//
// The Edesy agent is shared, so only ONE call may be "being started" at a time
// across the whole server (manual or scheduled). That is what `agentBusy` guards.

import Call from "./models/Call.js";
import { placeOutboundCall } from "./edesy.js";
import { updateEdesyAgentForPathway } from "./pathwayAgent.js";

// A second call to the same number inside this window is treated as an
// accidental double-click and rejected — every call costs Edesy credits.
const DUPLICATE_WINDOW_MS = 60_000;

let agentBusy = false;

export class CallStartError extends Error {
  constructor(message, { status = 500, code = "INTERNAL", conversationId } = {}) {
    super(message);
    this.name = "CallStartError";
    this.status = status;
    this.code = code;
    if (conversationId) this.conversationId = conversationId;
  }
}

/**
 * @param {object} p
 * @param {string} p.userId
 * @param {string} p.phoneNumber   already normalised (normalizePhoneNumber().value)
 * @param {string} [p.customerName]
 * @param {string} [p.purpose]
 * @param {object} [p.variables]
 * @param {string|null} [p.pathwayId]
 * @returns {Promise<{result: object, doc: object, pathway: object|null}>}
 * @throws {CallStartError | EdesyError | PathwayPromptError}
 */
export async function startCall({
  userId,
  phoneNumber,
  customerName = "",
  purpose = "",
  variables = {},
  pathwayId = null,
}) {
  if (agentBusy) {
    throw new CallStartError(
      "A call request is already in progress. Please wait for it to finish.",
      { status: 429, code: "CALL_IN_PROGRESS" }
    );
  }
  agentBusy = true;

  try {
    const recent = await Call.findOne({
      userId,
      provider: "edesy",
      phone: phoneNumber,
      createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
    }).select("_id executionId");

    if (recent) {
      throw new CallStartError(
        "A call to this number was started less than a minute ago. Check Call History before calling again.",
        { status: 429, code: "DUPLICATE_CALL" }
      );
    }

    // Step 1 — put this pathway's flow on the shared agent and WAIT for Edesy
    // to confirm. If this throws, nobody is dialled.
    let pathway = null;
    if (pathwayId) {
      pathway = await updateEdesyAgentForPathway(pathwayId, userId);
    }

    const metadata = {};
    if (purpose) metadata.purpose = purpose;
    if (pathway) {
      metadata.pathwayId = pathway.pathwayId;
      metadata.pathwayName = pathway.pathwayName;
      metadata.pathwaySteps = String(pathway.stepCount);
    }

    // Step 2 — only now place the call.
    const result = await placeOutboundCall(phoneNumber, variables, { metadata });

    let doc;
    try {
      doc = await Call.create({
        executionId: result.conversationId,
        provider: "edesy",
        providerStatus: result.status,
        providerAgentId: String(result.agentId),
        callSid: result.callSid,
        contact: customerName || "Unknown",
        phone: phoneNumber,
        purpose,
        status: "In Progress",
        duration: "0:00",
        type: "Outbound",
        agent: "Edesy AI Agent",
        pathwayId: pathway?.pathwayId || null,
        pathwayName: pathway?.pathwayName || "",
        userId,
      });
    } catch (dbErr) {
      // The call IS in progress on Edesy; only our record failed.
      console.error("[edesy] Call placed but saving to MongoDB failed:", dbErr.message);
      throw new CallStartError(
        `The call was placed (ID ${result.conversationId}) but couldn't be saved to your history. Do not retry — check the Edesy dashboard.`,
        { status: 500, code: "SAVE_FAILED", conversationId: result.conversationId }
      );
    }

    return { result, doc, pathway };
  } finally {
    agentBusy = false;
  }
}