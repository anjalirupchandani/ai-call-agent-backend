// lib/callStarter.js
// ONE place that places a real outbound Edesy call. Used by BOTH:
//   • controllers/callController.js  (Start Call button)
//   • lib/scheduler.js               (appointment time reached)
//   • startMultipleCalls() below     (Multiple Calls / bulk)
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

// ─────────────────────────────────────────────────────────────────────────────
// Bulk calling
// ─────────────────────────────────────────────────────────────────────────────

// Places the call on Edesy and saves the Call record. Used by startMultipleCalls().
// (The pathway, if any, has ALREADY been applied to the shared agent.)
async function placeAndSave({ userId, phoneNumber, customerName, purpose, variables, pathway }) {
  const metadata = {};
  if (purpose) metadata.purpose = purpose;
  if (pathway) {
    metadata.pathwayId = pathway.pathwayId;
    metadata.pathwayName = pathway.pathwayName;
    metadata.pathwaySteps = String(pathway.stepCount);
  }

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
    console.error("[edesy] Bulk call placed but saving to MongoDB failed:", dbErr.message);
    throw new CallStartError(
      `The call was placed (ID ${result.conversationId}) but couldn't be saved to your history. Do not retry — check the Edesy dashboard.`,
      { status: 500, code: "SAVE_FAILED", conversationId: result.conversationId }
    );
  }

  return { result, doc, pathway };
}

/**
 * Place several outbound calls in one request (the "Multiple Calls" tab).
 *
 * Because the Edesy agent is shared, the server-wide `agentBusy` lock is held for
 * the WHOLE batch: the pathway is applied to the agent ONCE per distinct pathway,
 * then the calls for that pathway are placed in parallel groups of `concurrency`.
 * A single call or a scheduled call that arrives meanwhile gets CALL_IN_PROGRESS
 * (the scheduler simply retries on its next tick).
 *
 * Each number is handled independently — one failure never stops the others.
 *
 * @param {Array<{phoneNumber:string, customerName?:string, purpose?:string,
 *                variables?:object, pathwayId?:string|null}>} callRequests
 *        phoneNumber must already be normalised (normalizePhoneNumber().value)
 * @param {string} userId
 * @param {{ concurrency?: number }} [options]  max calls placed at the same time (default 5)
 * @returns {Promise<Array<{phoneNumber:string, success:boolean, result?:object,
 *                          doc?:object, pathway?:object|null, error?:string, code?:string}>>}
 *          one entry per request, in the same order as the input
 * @throws {CallStartError} CALL_IN_PROGRESS when another call is being started
 */
export async function startMultipleCalls(callRequests, userId, { concurrency = 5 } = {}) {
  if (agentBusy) {
    throw new CallStartError(
      "A call request is already in progress. Please wait for it to finish.",
      { status: 429, code: "CALL_IN_PROGRESS" }
    );
  }
  agentBusy = true;

  try {
    const size = Math.max(1, Math.min(Math.floor(Number(concurrency)) || 5, 50));
    const results = new Array(callRequests.length);

    const fail = (i, err) => {
      results[i] = {
        phoneNumber: callRequests[i].phoneNumber,
        success: false,
        error: err?.message || "Call failed.",
        code: err?.code || "INTERNAL",
      };
    };

    // 1 — Duplicate protection (same rules as a single call, plus repeats inside
    //     this batch). Checked BEFORE touching the agent so nothing is changed
    //     on Edesy for numbers that will be skipped anyway.
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
    const recentDocs = await Call.find({
      userId,
      provider: "edesy",
      phone: { $in: callRequests.map((r) => r.phoneNumber) },
      createdAt: { $gte: since },
    }).select("phone");
    const recentPhones = new Set(recentDocs.map((c) => c.phone));

    const seen = new Set();
    const todo = [];
    callRequests.forEach((r, i) => {
      if (seen.has(r.phoneNumber)) {
        fail(i, { message: "This number is listed more than once — it will only be called once.", code: "DUPLICATE_IN_BATCH" });
      } else if (recentPhones.has(r.phoneNumber)) {
        fail(i, { message: "A call to this number was started less than a minute ago. Check Call History before calling again.", code: "DUPLICATE_CALL" });
      } else {
        seen.add(r.phoneNumber);
        todo.push(i);
      }
    });

    // 2 — Group by pathway (normally every row shares one).
    const groups = new Map();
    for (const i of todo) {
      const key = callRequests[i].pathwayId ? String(callRequests[i].pathwayId) : "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }

    // 3 — For each pathway: update the shared agent once and WAIT for Edesy, then
    //     place that group's calls in parallel chunks. If the agent can't be
    //     prepared, nobody in that group is dialled.
    for (const [pathwayId, indexes] of groups) {
      let pathway = null;
      if (pathwayId) {
        try {
          pathway = await updateEdesyAgentForPathway(pathwayId, userId);
        } catch (err) {
          indexes.forEach((i) => fail(i, err));
          continue;
        }
      }

      for (let s = 0; s < indexes.length; s += size) {
        const chunk = indexes.slice(s, s + size);
        await Promise.all(
          chunk.map(async (i) => {
            const r = callRequests[i];
            try {
              const out = await placeAndSave({
                userId,
                phoneNumber: r.phoneNumber,
                customerName: r.customerName || "",
                purpose: r.purpose || "",
                variables: r.variables || {},
                pathway,
              });
              results[i] = { phoneNumber: r.phoneNumber, success: true, ...out };
            } catch (err) {
              fail(i, err);
            }
          })
        );
      }
    }

    return results;
  } finally {
    agentBusy = false;
  }
}