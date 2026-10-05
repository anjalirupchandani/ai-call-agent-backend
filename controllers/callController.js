// controllers/callController.js — Edesy + MongoDB
import mongoose from "mongoose";
import Call from "../lib/models/Call.js";

import {
  EdesyError,
  getCallStatus as getEdesyCallStatus,
  endCall as endEdesyCall,
  normalizePhoneNumber,
  isFinalStatus,
} from "../lib/edesy.js";

import { PathwayPromptError } from "../lib/pathwayPrompt.js";
import { startCall, CallStartError } from "../lib/callStarter.js";

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function formatTime(date) {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
function docToRow(doc) {
  return {
    id: doc._id,
    contact: doc.contact,
    phone: doc.phone,
    date: formatDate(doc.createdAt),
    time: formatTime(doc.createdAt),
    duration: doc.duration,
    status: doc.status,
    type: doc.type,
    agent: doc.agent,
    callId: doc.executionId || "",
    summary: doc.summary || "",
    provider: doc.provider || "",
  };
}

// Finds a call by MongoDB _id OR by the Edesy conversationId stored in executionId
async function findCall(id, userId) {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return Call.findOne({ _id: id, userId });
  }
  return Call.findOne({ executionId: id, userId });
}

// GET /api/calls
export async function listCalls(req, res) {
  try {
    const calls = await Call.find({ userId: req.userId }).sort({
      createdAt: -1,
    });
    await Promise.all(
      calls
        .filter((call) => call.provider === "edesy" && !isFinalStatus(call.status))
        .map((call) => syncEdesyCall(call))
    );
    res.json(calls.map(docToRow));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// ── Edesy ─────────────────────────────────────────────────────────────────────

// Stop asking Edesy about a finished call once it is this old (summary/transcript
// that still haven't appeared by then are not going to).
const SYNC_MAX_AGE_MS = 60 * 60_000;

function validateVariables(input) {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Variables must be a set of name/value pairs." };
  }
  const entries = Object.entries(input);
  if (entries.length > 25) {
    return { ok: false, error: "Too many variables (maximum 25)." };
  }
  const out = {};
  for (const [rawKey, rawVal] of entries) {
    const key = String(rawKey).trim();
    if (!key) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,49}$/.test(key)) {
      return {
        ok: false,
        error: `Variable name "${key.slice(0, 30)}" is invalid. Use letters, numbers and underscores only, starting with a letter.`,
      };
    }
    if (rawVal === undefined || rawVal === null) continue;
    const val = String(rawVal).trim().slice(0, 500);
    if (val) out[key] = val;
  }
  return { ok: true, value: out };
}

// POST /api/calls
// Body: { phoneNumber, customerName?, purpose?, variables?, pathwayId? }
// Places ONE real outbound call through Edesy. No retries, no background work.
export async function createEdesyCall(req, res) {
  try {
    const { phoneNumber, customerName, purpose, variables, pathwayId } = req.body || {};

    const phone = normalizePhoneNumber(phoneNumber);
    if (!phone.ok) {
      return res.status(400).json({ success: false, message: phone.error, code: "INVALID_PHONE" });
    }

    const vars = validateVariables(variables);
    if (!vars.ok) {
      return res.status(400).json({ success: false, message: vars.error, code: "INVALID_VARIABLES" });
    }

    // ── Optional pathway. Only the id is checked here; the pathway itself is
    //    loaded fresh from MongoDB by updateEdesyAgentForPathway() further down,
    //    using THIS request's pathwayId (never frontend state or a cached prompt).
    const hasPathway = pathwayId !== undefined && pathwayId !== null && pathwayId !== "";
    if (hasPathway && !mongoose.Types.ObjectId.isValid(pathwayId)) {
      return res.status(400).json({ success: false, message: "Invalid pathwayId.", code: "INVALID_PATHWAY_ID" });
    }

    const name = typeof customerName === "string" ? customerName.trim().slice(0, 100) : "";
    const callPurpose = typeof purpose === "string" ? purpose.trim().slice(0, 200) : "";

    // The customer's name is the most common variable, so send it automatically
    // unless the caller supplied their own customer_name.
    const callVariables = { ...vars.value };
    if (name && callVariables.customer_name === undefined) callVariables.customer_name = name;

    // Lock, duplicate check, pathway → agent update, placing the call and saving
    // the Call record all live in lib/callStarter.js (shared with the scheduler).
    const { result, doc, pathway } = await startCall({
      userId: req.userId,
      phoneNumber: phone.value,
      customerName: name,
      purpose: callPurpose,
      variables: callVariables,
      pathwayId: hasPathway ? pathwayId : null,
    });

    return res.status(201).json({
      success: true,
      conversationId: result.conversationId,
      status: result.status,
      // Same fields the existing frontend flow already uses:
      callId: result.conversationId,
      dbId: doc._id,
      pathwayId: pathway?.pathwayId || null,
      pathwayName: pathway?.pathwayName || "",
    });
  } catch (err) {
    if (err instanceof CallStartError) {
      return res.status(err.status).json({
        success: false,
        message: err.message,
        code: err.code,
        ...(err.conversationId ? { conversationId: err.conversationId } : {}),
      });
    }
    if (err instanceof EdesyError) {
      return res.status(err.status).json({ success: false, message: err.message, code: err.code });
    }
    if (err instanceof PathwayPromptError) {
      return res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
    }
    console.error("[edesy] createEdesyCall unexpected error:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while starting the call. Check Call History before trying again.",
      code: "INTERNAL",
    });
  }
}

// Refreshes an Edesy call record from Edesy. Only talks to Edesy while it can
// still learn something: the call is unfinished, or it finished recently and its
// summary/transcript haven't arrived yet. Never throws — on any Edesy error the
// last known state is kept, and a warning message is returned for the UI.
async function syncEdesyCall(doc) {
  const finished = isFinalStatus(doc.status);
  const hasPostCallData = Boolean(doc.summary) || (doc.transcript && doc.transcript.length > 0);
  const recent = Date.now() - new Date(doc.createdAt).getTime() < SYNC_MAX_AGE_MS;

  if (!doc.executionId || (finished && (hasPostCallData || !recent))) return null;

  try {
    const d = await getEdesyCallStatus(doc.executionId);

    doc.status = d.status;
    doc.providerStatus = d.providerStatus || doc.providerStatus;
    if (d.disposition) doc.disposition = d.disposition;
    if (d.callSid) doc.callSid = d.callSid;
    if (d.duration) doc.duration = d.duration;
    if (d.summary) doc.summary = d.summary;
    if (d.recordingUrl) doc.recordingUrl = d.recordingUrl;
    if (d.transcript.length > 0) doc.transcript = d.transcript;

    if (doc.isModified()) await doc.save();
    return null;
  } catch (err) {
    console.warn(`[edesy] status sync failed for ${doc.executionId}: ${err.message}`);
    return err instanceof EdesyError ? err.message : "Couldn't refresh the call status.";
  }
}

// GET /api/calls/:id   (:id = MongoDB _id or the Edesy conversationId)
export async function getCall(req, res) {
  try {
    const doc = await findCall(req.params.id, req.userId);
    if (!doc) return res.status(404).json({ message: "Call not found" });

    let syncError = null;
    if (doc.provider === "edesy") {
      syncError = await syncEdesyCall(doc);
    }

    res.json({
      id: doc._id,
      executionId: doc.executionId,
      contact: {
        name: doc.contact,
        phone: doc.phone,
        email: "—",
      },
      date: formatDate(doc.createdAt),
      time: formatTime(doc.createdAt),
      duration: doc.duration,
      status: doc.status,
      agent: doc.agent,
      summary: doc.summary || "",
      insights: doc.insights || [],
      followUp: doc.followUp || "",
      transcript: doc.transcript || [],
      leadScore: doc.leadScore,
      customerIntent: doc.customerIntent,
      goalAlignment: doc.goalAlignment,
      nextActions: doc.nextActions,
      // Edesy fields
      provider: doc.provider || "",
      providerStatus: doc.providerStatus || "",
      disposition: doc.disposition || "",
      recordingUrl: doc.recordingUrl || "",
      syncError,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/calls/:id/end
//
// Edesy's public REST API does support ending an active call via
// POST /calls/{conversationId}/end (wrapped in lib/edesy.js as endCall()).
// We still refuse to pretend a call ended: we ask Edesy to end it, and if
// Edesy says it was already final (or refuses), we return the real state
// with ended:false rather than flipping the local record.
export async function endCallHandler(req, res) {
  try {
    const doc = await findCall(req.params.id, req.userId);

    // Non-Edesy records are not something we can end — there is no provider
    // integration for them anymore in this app.
    if (!doc) {
      return res.status(404).json({ message: "Call not found" });
    }
    if (doc.provider !== "edesy" || !doc.executionId) {
      return res.status(400).json({
        message: "This call isn't an Edesy call and can't be ended from here.",
        ended: false,
      });
    }

    // If our local record already shows a final status, don't ask Edesy again.
    if (isFinalStatus(doc.status)) {
      return res.json({
        callId: doc.executionId,
        status: doc.status,
        ended: false,
        message: `This call is already ${doc.status.toLowerCase()}.`,
      });
    }

    try {
      await endEdesyCall(doc.executionId);
    } catch (err) {
      // Edesy said no (already final, not found, network, …). Reflect that
      // honestly — do NOT mark the local record as Completed.
      if (err instanceof EdesyError) {
        return res.status(err.status).json({
          callId: doc.executionId,
          status: doc.status,
          ended: false,
          message: err.message,
          code: err.code,
        });
      }
      throw err;
    }

    // Edesy accepted the hangup. Sync the real state instead of guessing it.
    const syncError = await syncEdesyCall(doc);

    return res.json({
      callId: doc.executionId,
      status: doc.status,
      ended: true,
      ...(syncError ? { syncError } : {}),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// DELETE /api/calls/:id
export async function deleteCallHandler(req, res) {
  try {
    if (mongoose.Types.ObjectId.isValid(req.params.id)) {
      await Call.deleteOne({ _id: req.params.id, userId: req.userId });
    } else {
      await Call.deleteOne({ executionId: req.params.id, userId: req.userId });
    }
    res.json({ message: "Call removed." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// Exported for dashboardController
export async function getCallsForUser(userId) {
  return Call.find({ userId }).sort({ createdAt: -1 });
}
