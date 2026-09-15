// lib/templates.js — MongoDB-backed via Template model
import Template from "./models/Template.js";

export async function getTemplates(userId) {
  return Template.find({ userId }).sort({ createdAt: -1 });
}

export async function getTemplateById(templateId, userId) {
  if (!templateId) throw Object.assign(new Error("Template ID is required"), { status: 400 });
  return Template.findOne({ _id: templateId, userId });
}

export async function createTemplate(data) {
  return Template.create({
    name:    data.name,
    type:    data.type,
    content: data.content,
    tags:    data.tags || [],
    userId:  data.userId,
  });
}

export async function updateTemplate(templateId, userId, data) {
  if (!templateId) throw Object.assign(new Error("Template ID is required"), { status: 400 });
  return Template.findOneAndUpdate(
    { _id: templateId, userId },
    { $set: data },
    { new: true }
  );
}

export async function deleteTemplate(templateId, userId) {
  if (!templateId) throw Object.assign(new Error("Template ID is required"), { status: 400 });
  const result = await Template.deleteOne({ _id: templateId, userId });
  return result.deletedCount > 0;
}

export async function duplicateTemplate(templateId, userId) {
  if (!templateId) throw Object.assign(new Error("Template ID is required"), { status: 400 });
  const existing = await Template.findOne({ _id: templateId, userId });
  if (!existing) return null;
  const { _id, createdAt, updatedAt, ...rest } = existing.toObject();
  return Template.create({ ...rest, name: `${existing.name} (Copy)`, usageCount: 0 });
}

export async function incrementTemplateUsage(templateId, userId) {
  if (!templateId) throw Object.assign(new Error("Template ID is required"), { status: 400 });
  return Template.findOneAndUpdate(
    { _id: templateId, userId },
    { $inc: { usageCount: 1 } },
    { new: true }
  );
}
