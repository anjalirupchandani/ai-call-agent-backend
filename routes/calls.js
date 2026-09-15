// routes/calls.js
import { Router } from "express";
import {
  listCalls,
  getCall,
  startCallHandler,
  endCallHandler,
  deleteCallHandler,
} from "../controllers/callController.js";

const router = Router();

router.get("/", listCalls);
router.get("/:id", getCall);
router.post("/start", startCallHandler);
router.post("/:id/end", endCallHandler);
router.delete("/:id", deleteCallHandler);

export default router;
