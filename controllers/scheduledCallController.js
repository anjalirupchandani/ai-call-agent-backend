// controllers/scheduledCallController.js — MongoDB-backed via ScheduledCall model
import mongoose from "mongoose";
import ScheduledCall from "../lib/models/ScheduledCall.js";
import Pathway from "../lib/models/Pathway.js";
import { normalizePhoneNumber } from "../lib/edesy.js";
import { createNotification } from "./notificationController.js";

// Returns { ok, pathway } — pathway is null when none was chosen.
async function resolvePathway(pathwayId, userId) {
  if (pathwayId === undefined || pathwayId === null || pathwayId === "") {
    return { ok: true, pathway: null };
  }
  if (!mongoose.Types.ObjectId.isValid(pathwayId)) {
    return { ok: false, message: "Invalid pathway." };
  }
  const pathway = await Pathway.findOne({ _id: pathwayId, userId }).select("name status");
  if (!pathway) return { ok: false, message: "Pathway not found." };
  if (pathway.status !== "deployed") {
    return {
      ok: false,
      message: `Pathway "${pathway.name}" is not deployed yet. Deploy it in the Pathways editor first.`,
    };
  }
  return { ok: true, pathway };
}

// GET /api/scheduled-calls
export async function listScheduledCalls(req, res) {
  try {
    const calls = await ScheduledCall.find({ userId: req.userId }).sort({ scheduledAt: 1 });
    res.json(calls);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/scheduled-calls
export async function createScheduledCall(req, res) {
  try {
    const { contactId, phoneNumber, name, scheduledAt, notes, agentId, pathwayId } = req.body;
    if (!phoneNumber) return res.status(400).json({ message: "Phone number is required" });
    if (!scheduledAt) return res.status(400).json({ message: "Scheduled time is required" });

    // Reject a bad number now, not at call time (a failed appointment is a wasted slot).
    const phone = normalizePhoneNumber(phoneNumber);
    if (!phone.ok) return res.status(400).json({ message: phone.error });

    const scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime()))
      return res.status(400).json({ message: "Invalid date/time" });
    if (scheduledDate.getTime() <= Date.now())
      return res.status(400).json({ message: "Scheduled time must be in the future" });

    const p = await resolvePathway(pathwayId, req.userId);
    if (!p.ok) return res.status(400).json({ message: p.message });

    const call = await ScheduledCall.create({
      userId:      req.userId,
      contactId:   contactId || null,
      phoneNumber: phoneNumber.trim(),
      name:        name?.trim() || phoneNumber.trim(),
      scheduledAt: scheduledDate,
      notes:       notes?.trim() || "",
      agentId:     agentId || "",
      pathwayId:   p.pathway?._id || null,
      pathwayName: p.pathway?.name || "",
    });

    await createNotification(req.userId, {
      type: "call_scheduled",
      title: "Call scheduled",
      message: `${call.name} — ${scheduledDate.toLocaleString()}`,
      link: "/dashboard/scheduled-calls",
      meta: { scheduledCallId: String(call._id) },
    });

    res.status(201).json(call);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// PUT /api/scheduled-calls/:id   (only while still pending)
export async function updateScheduledCall(req, res) {
  try {
    const call = await ScheduledCall.findOne({ _id: req.params.id, userId: req.userId });
    if (!call) return res.status(404).json({ message: "Scheduled call not found" });
    if (call.status !== "pending")
      return res.status(400).json({ message: `A ${call.status} call can't be edited.` });

    const { phoneNumber, name, scheduledAt, notes, agentId, pathwayId } = req.body;

    if (phoneNumber) {
      const phone = normalizePhoneNumber(phoneNumber);
      if (!phone.ok) return res.status(400).json({ message: phone.error });
      call.phoneNumber = phoneNumber.trim();
    }
    if (name)                  call.name  = name.trim();
    if (notes !== undefined)   call.notes = notes.trim();
    if (agentId !== undefined) call.agentId = agentId;

    if (pathwayId !== undefined) {
      const p = await resolvePathway(pathwayId, req.userId);
      if (!p.ok) return res.status(400).json({ message: p.message });
      call.pathwayId = p.pathway?._id || null;
      call.pathwayName = p.pathway?.name || "";
    }

    if (scheduledAt) {
      const newDate = new Date(scheduledAt);
      if (Number.isNaN(newDate.getTime()))
        return res.status(400).json({ message: "Invalid date/time" });
      if (newDate.getTime() <= Date.now())
        return res.status(400).json({ message: "Scheduled time must be in the future" });
      call.scheduledAt = newDate;
    }
    await call.save();
    res.json(call);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/scheduled-calls/:id/cancel   (atomic: can't cancel a call already being placed)
export async function cancelScheduledCall(req, res) {
  try {
    const call = await ScheduledCall.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId, status: "pending" },
      { $set: { status: "cancelled" } },
      { new: true }
    );
    if (call) return res.json(call);

    const existing = await ScheduledCall.findOne({ _id: req.params.id, userId: req.userId });
    if (!existing) return res.status(404).json({ message: "Scheduled call not found" });
    if (existing.status === "cancelled") return res.status(400).json({ message: "Call is already cancelled" });
    if (existing.status === "calling") return res.status(400).json({ message: "This call is being placed right now and can't be cancelled." });
    return res.status(400).json({ message: `Cannot cancel a ${existing.status} call` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// DELETE /api/scheduled-calls/:id
export async function deleteScheduledCall(req, res) {
  try {
    const call = await ScheduledCall.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId,
      status: { $ne: "calling" },
    });
    if (!call) return res.status(404).json({ message: "Scheduled call not found (or it is being placed right now)" });
    res.json({ message: "Scheduled call deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }

}