// routes/scheduledCalls.js
import { Router } from "express";
import {
  listScheduledCalls,
  createScheduledCall,
  updateScheduledCall,
  cancelScheduledCall,
  deleteScheduledCall,
} from "../controllers/scheduledCallController.js";

const router = Router();

router.get("/", listScheduledCalls);
router.post("/", createScheduledCall);
router.put("/:id", updateScheduledCall);
router.post("/:id/cancel", cancelScheduledCall);
router.delete("/:id", deleteScheduledCall);

export default router;
