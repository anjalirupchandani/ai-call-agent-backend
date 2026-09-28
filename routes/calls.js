// routes/calls.js
import { Router } from "express";
import {
  listCalls,
  getCall,
  createEdesyCall,
  endCallHandler,
  deleteCallHandler,
} from "../controllers/callController.js";

const router = Router();

router.get("/", listCalls);
router.post("/", createEdesyCall);          // Edesy outbound call (one real call per request)
router.get("/:id", getCall);                // by MongoDB _id OR provider call ID (Edesy conversationId)
router.post("/:id/end", endCallHandler);    // Edesy hang-up (no-op / honest failure if already final)
router.delete("/:id", deleteCallHandler);

export default router;