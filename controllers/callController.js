// controllers/callController.js — Cognidom + MongoDB
import mongoose from "mongoose";
import Call from "../lib/models/Call.js";
import Pathway from "../lib/models/Pathway.js";
import { startCall  , stopCall, getCallDetails } from "../lib/cognidom.js";
import KnowledgeArticle from "../lib/models/KnowledgeArticle.js";

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
  };
}

// Finds a call by MongoDB _id OR by RabbitCalls executionId
async function findCall(id, userId) {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return Call.findOne({ _id: id, userId });
  }
  // fallback: look up by executionId (RabbitCalls call ID)
  return Call.findOne({ executionId: id, userId });
}

// GET /api/calls
export async function listCalls(req, res) {
  try {
    const calls = await Call.find({ userId: req.userId }).sort({
      createdAt: -1,
    });
    res.json(calls.map(docToRow));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/calls/:id
export async function getCall(req, res) {
  try {
    const doc = await findCall(req.params.id, req.userId);
    if (!doc) return res.status(404).json({ message: "Call not found" });

    let callDetail = null;
    if (doc.executionId) {
      callDetail = await getCallDetails(doc.executionId).catch(() => null);
    }

    res.json({
      id: doc._id,
      executionId: doc.executionId,
      contact: {
        name: callDetail?.contact?.name || doc.contact,
        phone: callDetail?.contact?.phone || doc.phone,
        email: "—",
      },
      date: formatDate(doc.createdAt),
      time: formatTime(doc.createdAt),
      duration: callDetail?.duration || doc.duration,
      status: callDetail?.status || doc.status,
      agent: doc.agent,
      summary: callDetail?.summary || doc.summary || "",
      insights: callDetail?.insights || doc.insights || [],
      followUp: callDetail?.followUp || doc.followUp || "",
      transcript: callDetail?.transcript || doc.transcript || [],
      pathwayId: doc.pathwayId,
      pathwayName: doc.pathwayName,
      leadScore: doc.leadScore,
      customerIntent: doc.customerIntent,
      goalAlignment: doc.goalAlignment,
      nextActions: doc.nextActions,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/calls/start
// Body: { phone, contactName, purpose, pathwayId }
// The agent Cognidom uses is resolved from the selected pathway's
// cognidomAgentId — see lib/cognidom.js for why a pathway graph itself
// can't be sent per-call.
export async function startCallHandler(req, res) {
  try {
    let pathway = null;
    if (req.body.pathwayId) {
      if (!mongoose.Types.ObjectId.isValid(req.body.pathwayId)) {
        return res.status(400).json({ message: "Invalid pathwayId." });
      }
      pathway = await Pathway.findOne({
        _id: req.body.pathwayId,
        userId: req.userId,
      });
      if (!pathway)
        return res.status(404).json({ message: "Pathway not found." });
      if (!pathway.cognidomAgentId) {
        return res.status(400).json({
          message: `Pathway "${pathway.name}" has no Cognidom agent linked yet. Open it in the Pathways editor and set the Cognidom Agent ID before starting a call with it.`,
        });
      }
    }

    // Knowledge base URLs aren't part of Cognidom's documented call payload
    // (unlike RabbitCalls), so they're no longer sent here. Attach them to
    // the agent's knowledge base in the Cognidom dashboard instead.
    void KnowledgeArticle;

    const result = await startCall({
      phone: req.body.phone,
      contactName: req.body.contactName,
      purpose: req.body.purpose,
      agentId: pathway?.cognidomAgentId,
      pathwayId: pathway?._id?.toString(),
      pathwayName: pathway?.name,
    });

    const doc = await Call.create({
      executionId: result.callId || "",
      contact: req.body.contactName || "Unknown",
      phone: req.body.phone,
      purpose: req.body.purpose || "",
      status: result.status || "In Progress",
      duration: "0:00",
      type: "Outbound",
      agent: "Cognidom AI Agent",
      pathwayId: pathway?._id,
      pathwayName: pathway?.name || "",
      cognidomAgentId: pathway?.cognidomAgentId || "",
      userId: req.userId,
    });

    // Return both dbId (MongoDB _id) and callId (Cognidom call ID)
    res.json({
      dbId: doc._id, // use this for all subsequent backend calls
      callId: result.callId, // Cognidom call ID
      status: result.status,
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// POST /api/calls/:id/end
export async function endCallHandler(req, res) {
  try {
    const doc = await findCall(req.params.id, req.userId);
    if (doc) {
      doc.status = "Completed";
      if (doc.executionId) {
        await stopCall(doc.executionId).catch(() => null);
        const details = await getCallDetails(doc.executionId).catch(() => null);
        if (details) {
          doc.duration = details.duration || doc.duration;
          doc.summary = details.summary || "";
          doc.transcript = details.transcript || [];
        }
      }
      await doc.save();
    }
    res.json({ callId: req.params.id, status: "Completed" });
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
