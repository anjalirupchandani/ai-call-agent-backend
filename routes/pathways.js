// routes/pathways.js
import { Router } from "express";
import {
  listPathways,
  getPathway,
  createPathway,
  updatePathway,
  deletePathway,
} from "../controllers/pathwayController.js";

const router = Router();

router.get("/", listPathways);
router.get("/:id", getPathway);
router.post("/", createPathway);
router.put("/:id", updatePathway);
router.delete("/:id", deletePathway);

export default router;