// lib/pathways.js — MongoDB-backed via Pathway model.
//
// Pathways are SHARED: every logged-in user sees and uses the same pathways.
// `userId` on a pathway only records who created it — it is never used to
// filter reads, updates or deletes.
import Pathway from "./models/Pathway.js";

export async function getPathways() {
  return Pathway.find({}).sort({ createdAt: -1 });
}

export async function getPathwayById(pathwayId) {
  if (!pathwayId) throw Object.assign(new Error("Pathway ID is required"), { status: 400 });
  return Pathway.findOne({ _id: pathwayId });
}

export async function createPathway(data) {
  return Pathway.create({
    name:   data.name || "agent",
    nodes:  data.nodes || [],
    edges:  data.edges || [],
    status: data.status === "deployed" ? "deployed" : "draft",
    userId: data.userId,
  });
}

export async function updatePathway(pathwayId, data) {
  if (!pathwayId) throw Object.assign(new Error("Pathway ID is required"), { status: 400 });
  return Pathway.findOneAndUpdate(
    { _id: pathwayId },
    { $set: data },
    { new: true }
  );
}

export async function deletePathway(pathwayId) {
  if (!pathwayId) throw Object.assign(new Error("Pathway ID is required"), { status: 400 });
  const result = await Pathway.deleteOne({ _id: pathwayId });
  return result.deletedCount > 0;
}