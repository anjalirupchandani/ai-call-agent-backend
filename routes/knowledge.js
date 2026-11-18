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
  createQA,
  updateQA,
  createDirectoryEntry,
  updateDirectoryEntry,
} from "../controllers/knowledgeController.js";

const router = Router();

// List / get / delete apply to every entry type (qa, directory, document, website).
router.get("/", listArticles);
router.get("/:id", getArticle);
router.get("/:id/file", downloadArticleFile);

// Document upload (multipart).
router.post("/", upload.single("file"), createArticle);
// Website source.
router.post("/website", createWebsiteArticle);

// Manually entered Q&A pairs.
router.post("/qa", createQA);
router.put("/qa/:id", updateQA);

// Directory entries (persons + departments).
router.post("/directory", createDirectoryEntry);
router.put("/directory/:id", updateDirectoryEntry);

// Generic update (document re-upload) + delete (any entry type).
router.put("/:id", upload.single("file"), updateArticle);
router.delete("/:id", deleteArticle);

export default router;
