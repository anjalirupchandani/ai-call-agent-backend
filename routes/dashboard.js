// routes/dashboard.js
import { Router } from "express";
import {
  getStats,
  getOverview,
  getRecent,
  getActivity,
  getSettings,
  updateSettings,
  updatePreferences,
  clearCache,
} from "../controllers/dashboardController.js";

const router = Router();

router.get("/stats", getStats);
router.get("/overview", getOverview);
router.get("/recent", getRecent);
router.get("/activity", getActivity);
router.get("/settings", getSettings);
router.put("/settings", updateSettings);
router.put("/preferences", updatePreferences);
router.delete("/cache", clearCache);

export default router;
