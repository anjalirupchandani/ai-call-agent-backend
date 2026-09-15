// controllers/scheduledCallController.js — MongoDB-backed via ScheduledCall model
import ScheduledCall from "../lib/models/ScheduledCall.js";

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
    const { contactId, phoneNumber, name, scheduledAt, notes, agentId } = req.body;
    if (!phoneNumber) return res.status(400).json({ message: "Phone number is required" });
    if (!scheduledAt) return res.status(400).json({ message: "Scheduled time is required" });

    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate.getTime() <= Date.now())
      return res.status(400).json({ message: "Scheduled time must be in the future" });

    const call = await ScheduledCall.create({
      userId:      req.userId,
      contactId:   contactId || null,
      phoneNumber: phoneNumber.trim(),
      name:        name?.trim() || phoneNumber,
      scheduledAt: scheduledDate,
      notes:       notes?.trim() || "",
      agentId:     agentId || "",
    });
    res.status(201).json(call);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// PUT /api/scheduled-calls/:id
export async function updateScheduledCall(req, res) {
  try {
    const call = await ScheduledCall.findOne({ _id: req.params.id, userId: req.userId });
    if (!call) return res.status(404).json({ message: "Scheduled call not found" });

    const { phoneNumber, name, scheduledAt, notes, agentId } = req.body;
    if (phoneNumber)         call.phoneNumber = phoneNumber.trim();
    if (name)                call.name        = name.trim();
    if (notes !== undefined) call.notes       = notes.trim();
    if (agentId !== undefined) call.agentId   = agentId;
    if (scheduledAt) {
      const newDate = new Date(scheduledAt);
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

// POST /api/scheduled-calls/:id/cancel
export async function cancelScheduledCall(req, res) {
  try {
    const call = await ScheduledCall.findOne({ _id: req.params.id, userId: req.userId });
    if (!call) return res.status(404).json({ message: "Scheduled call not found" });
    if (call.status === "completed") return res.status(400).json({ message: "Cannot cancel a completed call" });
    if (call.status === "cancelled") return res.status(400).json({ message: "Call is already cancelled" });

    call.status = "cancelled";
    await call.save();
    res.json(call);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// DELETE /api/scheduled-calls/:id
export async function deleteScheduledCall(req, res) {
  try {
    const call = await ScheduledCall.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!call) return res.status(404).json({ message: "Scheduled call not found" });
    res.json({ message: "Scheduled call deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}
