// routes/calls.js
import { Router } from "express";
import {
  listCalls,
  getCall,
  createEdesyCall,
  createBulkCalls,
  endCallHandler,
  deleteCallHandler,
} from "../controllers/callController.js";

const router = Router();

router.get("/", listCalls);
router.post("/bulk", createBulkCalls); // multiple calls in one request (must stay above "/:id")
router.post("/", createEdesyCall);
router.get("/:id", getCall);
router.post("/:id/end", endCallHandler);
router.delete("/:id", deleteCallHandler);

export default router;