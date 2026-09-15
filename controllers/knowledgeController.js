// controllers/knowledgeController.js — MongoDB-backed via KnowledgeArticle model
import multer from "multer";
import KnowledgeArticle from "../lib/models/KnowledgeArticle.js";

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/csv",
    ];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error("Unsupported file type"));
  },
});

function extractText(buffer, mimetype) {
  if (mimetype === "text/plain" || mimetype === "text/csv")
    return buffer.toString("utf8").slice(0, 10_000);
  return `[Binary file — ${mimetype}]`;
}

function omitFileData(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.fileData;
  return obj;
}

// GET /api/knowledge
export async function listArticles(req, res) {
  try {
    const articles = await KnowledgeArticle.find({ userId: req.userId }, { fileData: 0 }).sort({ createdAt: -1 });
    res.json(articles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/knowledge/:id
export async function getArticle(req, res) {
  try {
    const article = await KnowledgeArticle.findOne({ _id: req.params.id, userId: req.userId }, { fileData: 0 });
    if (!article) return res.status(404).json({ message: "Article not found" });
    res.json(article);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/knowledge/:id/file
export async function downloadArticleFile(req, res) {
  try {
    const article = await KnowledgeArticle.findOne({ _id: req.params.id, userId: req.userId });
    if (!article)           return res.status(404).json({ message: "Article not found" });
    if (!article.fileData)  return res.status(404).json({ message: "No file stored for this article" });

    const buffer   = Buffer.from(article.fileData, "base64");
    const filename = encodeURIComponent(article.fileName || "document");
    res.set("Content-Type",        article.fileType || "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    res.set("Content-Length",      buffer.length);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/knowledge
export async function createArticle(req, res) {
  try {
    const { title, category } = req.body;
    if (!title?.trim()) return res.status(400).json({ message: "Title is required" });
    if (!req.file)      return res.status(400).json({ message: "File is required" });

    const article = await KnowledgeArticle.create({
      title:    title.trim(),
      content:  extractText(req.file.buffer, req.file.mimetype),
      category: category || "faq",
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType: req.file.mimetype,
      fileData: req.file.buffer.toString("base64"),
      userId:   req.userId,
    });
    res.status(201).json(omitFileData(article));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// POST /api/knowledge/website
export async function createWebsiteArticle(req, res) {
  try {
    const { title, category, url } = req.body;
    if (!url?.trim()) return res.status(400).json({ message: "Website URL is required" });

    let website;
    try {
      website = new URL(url.trim());
    } catch {
      return res.status(400).json({ message: "Enter a valid website URL" });
    }
    if (!['http:', 'https:'].includes(website.protocol)) {
      return res.status(400).json({ message: "Website URL must use HTTP or HTTPS" });
    }

    const article = await KnowledgeArticle.create({
      title: title?.trim() || website.hostname,
      content: `Website knowledge source: ${website.href}`,
      category: category || "faq",
      sourceType: "website",
      sourceUrl: website.href,
      userId: req.userId,
    });
    res.status(201).json(omitFileData(article));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// PUT /api/knowledge/:id
export async function updateArticle(req, res) {
  try {
    const article = await KnowledgeArticle.findOne({ _id: req.params.id, userId: req.userId });
    if (!article) return res.status(404).json({ message: "Article not found" });

    const { title, category } = req.body;
    if (title?.trim()) article.title    = title.trim();
    if (category)      article.category = category;
    if (req.file) {
      article.content  = extractText(req.file.buffer, req.file.mimetype);
      article.fileData = req.file.buffer.toString("base64");
      article.fileName = req.file.originalname;
      article.fileSize = req.file.size;
      article.fileType = req.file.mimetype;
    }
    await article.save();
    res.json(omitFileData(article));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// DELETE /api/knowledge/:id
export async function deleteArticle(req, res) {
  try {
    const article = await KnowledgeArticle.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!article) return res.status(404).json({ message: "Article not found" });
    res.json({ message: "Article deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}
