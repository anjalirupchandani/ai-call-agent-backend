// controllers/templateController.js
//
// Handlers for /api/templates/* — CRUD, duplication, and usage tracking
// for call script templates. Data access lives in lib/templates.js.

import {
  getTemplates,
  getTemplateById,
  createTemplate as createTemplateRecord,
  updateTemplate as updateTemplateRecord,
  deleteTemplate as deleteTemplateRecord,
  duplicateTemplate,
  incrementTemplateUsage,
} from "../lib/templates.js";

// GET /api/templates
export async function listTemplates(req, res) {
  try {
    res.json(await getTemplates(req.userId) || []);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// GET /api/templates/:id
export async function getTemplate(req, res) {
  try {
    const t = await getTemplateById(req.params.id, req.userId);
    if (!t) return res.status(404).json({ message: "Template not found" });
    res.json(t);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// POST /api/templates
export async function createTemplate(req, res) {
  try {
    const { name, type, content, tags = [] } = req.body;
    if (!name || !type || !content)
      return res.status(400).json({ message: "Name, type, and content are required" });
    res.status(201).json(await createTemplateRecord({ name, type, content, tags, userId: req.userId }));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// PUT /api/templates/:id
export async function updateTemplate(req, res) {
  try {
    const updated = await updateTemplateRecord(req.params.id, req.userId, req.body);
    if (!updated) return res.status(404).json({ message: "Template not found" });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// DELETE /api/templates/:id
export async function deleteTemplate(req, res) {
  try {
    const deleted = await deleteTemplateRecord(req.params.id, req.userId);
    if (!deleted) return res.status(404).json({ message: "Template not found" });
    res.json({ message: "Template deleted successfully" });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// POST /api/templates/:id/duplicate
export async function duplicateTemplateHandler(req, res) {
  try {
    const dup = await duplicateTemplate(req.params.id, req.userId);
    if (!dup) return res.status(404).json({ message: "Template not found" });
    res.status(201).json(dup);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// POST /api/templates/:id/use
export async function useTemplate(req, res) {
  try {
    const updated = await incrementTemplateUsage(req.params.id, req.userId);
    if (!updated) return res.status(404).json({ message: "Template not found" });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}
