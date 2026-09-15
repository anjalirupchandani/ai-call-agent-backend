// routes/templates.js
import { Router } from "express";
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplateHandler,
  useTemplate,
} from "../controllers/templateController.js";

const router = Router();

router.get("/", listTemplates);
router.get("/:id", getTemplate);
router.post("/", createTemplate);
router.put("/:id", updateTemplate);
router.delete("/:id", deleteTemplate);
router.post("/:id/duplicate", duplicateTemplateHandler);
router.post("/:id/use", useTemplate);

export default router;
