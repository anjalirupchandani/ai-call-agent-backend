// controllers/campaignController.js — MongoDB-backed via Campaign model
import Campaign from "../lib/models/Campaign.js";
import { startCall } from "../lib/rabbitcalls.js";

function toSummary(doc) {
  return {
    id:            doc._id,
    name:          doc.name,
    status:        doc.status,
    templateName:  doc.templateName,
    agentId:       doc.agentId,
    totalCalls:    doc.calls?.length || 0,
    concurrency:   doc.concurrency,
    pacingSeconds: doc.pacingSeconds,
    progress:      doc.progress,
    createdAt:     doc.createdAt,
    startedAt:     doc.startedAt,
    completedAt:   doc.completedAt,
  };
}

function toDetail(doc) {
  return {
    ...toSummary(doc),
    calls: (doc.calls || []).map((c) => ({
      id:          c._id,
      contactId:   c.contactId,
      name:        c.name,
      phoneNumber: c.phoneNumber,
      status:      c.status,
      executionId: c.executionId,
      attemptedAt: c.attemptedAt,
      error:       c.error,
    })),
  };
}

async function processCampaign(campaignId) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  while (true) {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign || campaign.status !== "running") break;

    const pending = campaign.calls.filter((c) => c.status === "pending");
    if (!pending.length) {
      campaign.status      = "completed";
      campaign.completedAt = new Date();
      await campaign.save();
      break;
    }

    const batch = pending.slice(0, campaign.concurrency);

    await Promise.all(batch.map(async (callDoc) => {
      callDoc.status      = "calling";
      callDoc.attemptedAt = new Date();
      await campaign.save();

      try {
        const result     = await startCall({ phone: callDoc.phoneNumber, contactName: callDoc.name, purpose: campaign.templateName, agentId: campaign.agentId });
        callDoc.status      = "completed";
        callDoc.executionId = result.callId || "";
      } catch (err) {
        callDoc.status = "failed";
        callDoc.error  = err.message;
      }
      await campaign.save();
    }));

    await delay((campaign.pacingSeconds || 5) * 1000);
  }
}

// GET /api/campaigns
export async function listCampaigns(req, res) {
  try {
    const list = await Campaign.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json(list.map(toSummary));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/campaigns/:id
export async function getCampaign(req, res) {
  try {
    const doc = await Campaign.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ message: "Campaign not found" });
    res.json(toDetail(doc));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/campaigns
export async function createCampaign(req, res) {
  try {
    const { name, templateId, templateName, agentId, concurrency, pacingSeconds, contacts } = req.body;
    if (!name?.trim())    return res.status(400).json({ message: "Campaign name is required" });
    if (!contacts?.length) return res.status(400).json({ message: "At least one contact is required" });

    const doc = await Campaign.create({
      userId:        req.userId,
      name:          name.trim(),
      templateId:    templateId || null,
      templateName:  templateName || "",
      agentId:       agentId || "",
      concurrency:   concurrency || 1,
      pacingSeconds: pacingSeconds || 5,
      calls: contacts.map((c) => ({
        contactId:   c.id || c._id || "",
        name:        c.name || "",
        phoneNumber: c.phone || c.phoneNumber || "",
        status:      "pending",
      })),
    });
    res.status(201).json(toDetail(doc));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/campaigns/:id/start
export async function startCampaign(req, res) {
  try {
    const doc = await Campaign.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ message: "Campaign not found" });
    if (!["draft", "paused"].includes(doc.status))
      return res.status(400).json({ message: `Cannot start a campaign with status: ${doc.status}` });

    doc.status    = "running";
    doc.startedAt = doc.startedAt || new Date();
    await doc.save();

    processCampaign(doc._id.toString()).catch((err) =>
      console.error(`[campaign] processing error: ${err.message}`)
    );
    res.json(toDetail(doc));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/campaigns/:id/pause
export async function pauseCampaign(req, res) {
  try {
    const doc = await Campaign.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ message: "Campaign not found" });
    if (doc.status !== "running") return res.status(400).json({ message: "Campaign is not running" });
    doc.status = "paused";
    await doc.save();
    res.json(toDetail(doc));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/campaigns/:id/cancel
export async function cancelCampaign(req, res) {
  try {
    const doc = await Campaign.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ message: "Campaign not found" });
    doc.status = "cancelled";
    await doc.save();
    res.json(toDetail(doc));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/campaigns/:id/retry
export async function retryCampaign(req, res) {
  try {
    const doc = await Campaign.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ message: "Campaign not found" });
    doc.calls.forEach((c) => { if (c.status === "failed") c.status = "pending"; });
    if (["completed", "cancelled"].includes(doc.status)) doc.status = "draft";
    await doc.save();
    res.json(toDetail(doc));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// DELETE /api/campaigns/:id
export async function deleteCampaign(req, res) {
  try {
    const doc = await Campaign.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ message: "Campaign not found" });
    res.json({ message: "Campaign deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}
