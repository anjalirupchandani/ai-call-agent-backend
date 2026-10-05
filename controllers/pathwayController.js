// controllers/pathwayController.js
//
// Handlers for /api/pathways/* — CRUD for call-flow pathways built in the
// Pathways canvas. Data access lives in lib/pathways.js.

import {
  getPathways,
  getPathwayById,
  createPathway as createPathwayRecord,
  updatePathway as updatePathwayRecord,
  deletePathway as deletePathwayRecord,
} from "../lib/Pathways.js";

// Fields a client is allowed to set on a Pathway. Anything outside this list
// (userId, _id, timestamps, and any leftover Cognidom field) is ignored.
function pickWritableFields(body = {}) {
  const out = {};

  if (typeof body.name === "string") {
    out.name = body.name.trim().slice(0, 200);
  }
  if (Array.isArray(body.nodes)) {
    out.nodes = body.nodes;
  }
  if (Array.isArray(body.edges)) {
    out.edges = body.edges;
  }
  if (body.status === "draft" || body.status === "deployed") {
    out.status = body.status;
  }

  return out;
}

// GET /api/pathways
export async function listPathways(req, res) {
  try {
    res.json((await getPathways()) || []);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// GET /api/pathways/:id
export async function getPathway(req, res) {
  try {
    const p = await getPathwayById(req.params.id);
    if (!p) return res.status(404).json({ message: "Pathway not found" });
    res.json(p);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// POST /api/pathways
export async function createPathway(req, res) {
  try {
    const fields = pickWritableFields(req.body);

    if (!fields.name) {
      return res.status(400).json({ message: "Pathway name is required." });
    }

    const created = await createPathwayRecord({
      ...fields,
      userId: req.userId,
    });

    res.status(201).json(created);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// PUT /api/pathways/:id
export async function updatePathway(req, res) {
  try {
    const fields = pickWritableFields(req.body);

    // Passing an empty object is legal — it just won't change anything.
    const updated = await updatePathwayRecord(req.params.id, fields);
    if (!updated) return res.status(404).json({ message: "Pathway not found" });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// DELETE /api/pathways/:id
export async function deletePathway(req, res) {
  try {
    const deleted = await deletePathwayRecord(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Pathway not found" });
    res.json({ message: "Pathway deleted successfully" });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}