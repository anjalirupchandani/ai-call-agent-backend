// routes/knowledge.js
import { Router } from "express";
import {
  upload,
  listArticles,
  getArticle,
  downloadArticleFile,
  createArticle,
  createWebsiteArticle,
  updateArticle,
  deleteArticle,
} from "../controllers/knowledgeController.js";

const router = Router();

router.get("/", listArticles);
router.get("/:id", getArticle);
router.get("/:id/file", downloadArticleFile);
router.post("/", upload.single("file"), createArticle);
router.post("/website", createWebsiteArticle);
router.put("/:id", upload.single("file"), updateArticle);
router.delete("/:id", deleteArticle);

export default router;
