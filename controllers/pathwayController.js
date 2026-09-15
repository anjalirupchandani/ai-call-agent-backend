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
} from "../lib/pathways.js";

// GET /api/pathways
export async function listPathways(req, res) {
  try {
    res.json(await getPathways(req.userId) || []);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// GET /api/pathways/:id
export async function getPathway(req, res) {
  try {
    const p = await getPathwayById(req.params.id, req.userId);
    if (!p) return res.status(404).json({ message: "Pathway not found" });
    res.json(p);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// POST /api/pathways
export async function createPathway(req, res) {
  try {
    const { name, nodes = [], edges = [], cognidomAgentId = "" } = req.body;
    res.status(201).json(
      await createPathwayRecord({ name, nodes, edges, cognidomAgentId, userId: req.userId })
    );
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// PUT /api/pathways/:id
export async function updatePathway(req, res) {
  try {
    const updated = await updatePathwayRecord(req.params.id, req.userId, req.body);
    if (!updated) return res.status(404).json({ message: "Pathway not found" });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// DELETE /api/pathways/:id
export async function deletePathway(req, res) {
  try {
    const deleted = await deletePathwayRecord(req.params.id, req.userId);
    if (!deleted) return res.status(404).json({ message: "Pathway not found" });
    res.json({ message: "Pathway deleted successfully" });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}