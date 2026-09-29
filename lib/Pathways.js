// lib/pathways.js — MongoDB-backed via Pathway model
import Pathway from "./models/Pathway.js";

export async function getPathways(userId) {
  return Pathway.find({ userId }).sort({ createdAt: -1 });
}

export async function getPathwayById(pathwayId, userId) {
  if (!pathwayId) throw Object.assign(new Error("Pathway ID is required"), { status: 400 });
  return Pathway.findOne({ _id: pathwayId, userId });
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

export async function updatePathway(pathwayId, userId, data) {
  if (!pathwayId) throw Object.assign(new Error("Pathway ID is required"), { status: 400 });
  return Pathway.findOneAndUpdate(
    { _id: pathwayId, userId },
    { $set: data },
    { new: true }
  );
}

export async function deletePathway(pathwayId, userId) {
  if (!pathwayId) throw Object.assign(new Error("Pathway ID is required"), { status: 400 });
  const result = await Pathway.deleteOne({ _id: pathwayId, userId });
  return result.deletedCount > 0;
}