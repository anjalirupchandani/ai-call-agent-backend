// routes/campaigns.js
import { Router } from "express";
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  startCampaign,
  pauseCampaign,
  cancelCampaign,
  retryCampaign,
  deleteCampaign,
} from "../controllers/campaignController.js";

const router = Router();

router.get("/", listCampaigns);
router.get("/:id", getCampaign);
router.post("/", createCampaign);
router.post("/:id/start", startCampaign);
router.post("/:id/pause", pauseCampaign);
router.post("/:id/cancel", cancelCampaign);
router.post("/:id/retry", retryCampaign);
router.delete("/:id", deleteCampaign);

export default router;
