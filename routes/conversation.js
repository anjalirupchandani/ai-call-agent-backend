// routes/conversation.js
import { Router } from "express";
import {
  startConversation,
  sendMessage,
  speakText,
  endConversation,
  listConversations,
  getConversation,
  deleteConversation,
} from "../controllers/conversationController.js";

const router = Router();

router.post("/start", startConversation);
router.post("/message", sendMessage);
router.post("/tts", speakText);
router.post("/end", endConversation);
router.get("/", listConversations);
router.get("/:sessionId", getConversation);
router.delete("/:sessionId", deleteConversation);

export default router;