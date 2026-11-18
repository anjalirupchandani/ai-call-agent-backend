// controllers/knowledgeController.js — MongoDB-backed via KnowledgeArticle model
import multer from "multer";
import KnowledgeArticle from "../lib/models/KnowledgeArticle.js";
import {
  MAX_CONTENT_CHARS,
  extractPdfText,
  extractWebsiteText,
  assertPublicUrl,
} from "../lib/knowledgeText.js";

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

// Returns { content, warning? }. `content` is what the voice agent can search.
// Extraction problems never block the upload; they come back as `warning` so the
// document is still stored/downloadable (and `npm run kb:reindex` can retry).
async function extractFileContent(file) {
  const { buffer, mimetype } = file;
  if (mimetype === "text/plain" || mimetype === "text/csv") {
    return { content: buffer.toString("utf8").slice(0, MAX_CONTENT_CHARS) };
  }
  if (mimetype === "application/pdf") {
    try {
      const content = await extractPdfText(buffer);
      if (content.length < 50) {
        return {
          content: `[Binary file — ${mimetype}]`,
          warning: "No readable text found in this PDF (it may be a scan). The voice agent can't answer from it.",
        };
      }
      return { content };
    } catch (err) {
      console.error("[knowledge] PDF text extraction failed:", err.message);
      return {
        content: `[Binary file — ${mimetype}]`,
        warning: `Saved, but the text couldn't be read: ${err.message}`,
      };
    }
  }
  // .doc / .docx: stored for download only; text extraction isn't implemented.
  return {
    content: `[Binary file — ${mimetype}]`,
    warning: "Saved, but the voice agent can only answer from PDF, TXT, CSV and website sources.",
  };
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

    const { content, warning } = await extractFileContent(req.file);
    const article = await KnowledgeArticle.create({
      title:    title.trim(),
      content,
      category: category || "faq",
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType: req.file.mimetype,
      fileData: req.file.buffer.toString("base64"),
      userId:   req.userId,
    });
    res.status(201).json({ ...omitFileData(article), ...(warning ? { warning } : {}) });
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

    // Refuse localhost / private-network addresses up front (SSRF protection).
    try {
      await assertPublicUrl(website.href);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    // Fetch the page text so the voice agent has something to answer from.
    let content = `Website knowledge source: ${website.href}`;
    let warning;
    try {
      const text = await extractWebsiteText(website.href);
      if (text.length >= 200) content = text;
      else warning = "Very little text was found on that page (it may load its content with JavaScript). The voice agent may not be able to answer from it.";
    } catch (err) {
      console.error(`[knowledge] fetching ${website.href} failed:`, err.message);
      warning = `Saved, but the page couldn't be read: ${err.message}`;
    }

    const article = await KnowledgeArticle.create({
      title: title?.trim() || website.hostname,
      content,
      category: category || "faq",
      sourceType: "website",
      sourceUrl: website.href,
      userId: req.userId,
    });
    res.status(201).json({ ...omitFileData(article), ...(warning ? { warning } : {}) });
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
    let warning;
    if (req.file) {
      const extracted = await extractFileContent(req.file);
      warning = extracted.warning;
      article.content  = extracted.content;
      article.fileData = req.file.buffer.toString("base64");
      article.fileName = req.file.originalname;
      article.fileSize = req.file.size;
      article.fileType = req.file.mimetype;
    }
    await article.save();
    res.json({ ...omitFileData(article), ...(warning ? { warning } : {}) });
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


// ── Q&A entries (manually entered question + answer) ─────────────────────────

const QA_CATEGORIES = ["general", "hours", "location", "contact", "services", "appointments", "team", "pricing", "policies", "faq", "company", "product", "policy", "support"];
const QA_LANGUAGES = ["", "en", "hi", "gu"];

function cleanList(arr, max = 12, eachMax = 300) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const v = String(raw || "").trim().slice(0, eachMax);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

// POST /api/knowledge/qa
// Body: { title?, question, answer, variations?, category?, language? }
export async function createQA(req, res) {
  try {
    const { title, question, answer, variations, category, language } = req.body || {};

    const q = String(question || "").trim();
    const a = String(answer || "").trim();
    if (!q) return res.status(400).json({ message: "Question is required" });
    if (!a) return res.status(400).json({ message: "Answer is required" });

    const cat = QA_CATEGORIES.includes(category) ? category : "general";
    const lang = QA_LANGUAGES.includes(language) ? language : "";

    const article = await KnowledgeArticle.create({
      entryType: "qa",
      title: String(title || q).trim().slice(0, 200) || q.slice(0, 200),
      question: q.slice(0, 1000),
      answer: a.slice(0, 4000),
      variations: cleanList(variations),
      category: cat,
      language: lang,
      userId: req.userId,
    });
    res.status(201).json(omitFileData(article));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// PUT /api/knowledge/qa/:id
// Body: { title?, question, answer, variations?, category?, language?, isActive? }
export async function updateQA(req, res) {
  try {
    const article = await KnowledgeArticle.findOne({ _id: req.params.id, userId: req.userId });
    if (!article) return res.status(404).json({ message: "Q&A entry not found" });
    if (article.entryType !== "qa") {
      return res.status(400).json({ message: "This entry is not a Q&A entry" });
    }

    const { title, question, answer, variations, category, language, isActive } = req.body || {};

    if (question !== undefined) {
      const q = String(question).trim();
      if (!q) return res.status(400).json({ message: "Question cannot be empty" });
      article.question = q.slice(0, 1000);
    }
    if (answer !== undefined) {
      const a = String(answer).trim();
      if (!a) return res.status(400).json({ message: "Answer cannot be empty" });
      article.answer = a.slice(0, 4000);
    }
    if (title !== undefined) article.title = String(title).trim().slice(0, 200) || article.question;
    if (variations !== undefined) article.variations = cleanList(variations);
    if (category !== undefined && QA_CATEGORIES.includes(category)) article.category = category;
    if (language !== undefined && QA_LANGUAGES.includes(language)) article.language = language;
    if (isActive !== undefined) article.isActive = Boolean(isActive);

    await article.save();
    res.json(omitFileData(article));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}


// ── Directory entries (persons + departments) ─────────────────────────────────

const DIR_CATEGORIES = ["team", "general"];

// POST /api/knowledge/directory
// Body: { directoryType, personName?, nameAliases?, designation?, department,
//         cabin?, directoryNotes?, isInterviewer?, category? }
export async function createDirectoryEntry(req, res) {
  try {
    const {
      directoryType,
      personName,
      nameAliases,
      designation,
      department,
      cabin,
      directoryNotes,
      isInterviewer,
      category,
    } = req.body || {};

    if (!directoryType || !["person", "department"].includes(directoryType)) {
      return res.status(400).json({ message: "directoryType must be 'person' or 'department'" });
    }
    if (directoryType === "person") {
      const n = String(personName || "").trim();
      if (!n) return res.status(400).json({ message: "personName is required for a person entry" });
    }
    if (!String(department || "").trim()) {
      return res.status(400).json({ message: "department is required" });
    }

    const pName = String(personName || "").trim().slice(0, 200);
    const title = directoryType === "person"
      ? pName || String(department || "").trim()
      : String(department || "").trim();

    const article = await KnowledgeArticle.create({
      entryType: "directory",
      directoryType,
      personName: pName,
      nameAliases: cleanList(nameAliases, 10, 100),
      designation: String(designation || "").trim().slice(0, 200),
      department: String(department || "").trim().slice(0, 200),
      cabin: String(cabin || "").trim().slice(0, 200),
      directoryNotes: String(directoryNotes || "").trim().slice(0, 500),
      isInterviewer: Boolean(isInterviewer),
      title,
      category: DIR_CATEGORIES.includes(category) ? category : "team",
      userId: req.userId,
    });
    res.status(201).json(omitFileData(article));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// PUT /api/knowledge/directory/:id
export async function updateDirectoryEntry(req, res) {
  try {
    const article = await KnowledgeArticle.findOne({ _id: req.params.id, userId: req.userId });
    if (!article) return res.status(404).json({ message: "Directory entry not found" });
    if (article.entryType !== "directory") {
      return res.status(400).json({ message: "This entry is not a directory entry" });
    }

    const {
      personName, nameAliases, designation, department,
      cabin, directoryNotes, isInterviewer, category, isActive,
    } = req.body || {};

    if (personName !== undefined) article.personName = String(personName).trim().slice(0, 200);
    if (nameAliases !== undefined) article.nameAliases = cleanList(nameAliases, 10, 100);
    if (designation !== undefined) article.designation = String(designation).trim().slice(0, 200);
    if (department !== undefined) article.department = String(department).trim().slice(0, 200);
    if (cabin !== undefined) article.cabin = String(cabin).trim().slice(0, 200);
    if (directoryNotes !== undefined) article.directoryNotes = String(directoryNotes).trim().slice(0, 500);
    if (isInterviewer !== undefined) article.isInterviewer = Boolean(isInterviewer);
    if (category !== undefined && DIR_CATEGORIES.includes(category)) article.category = category;
    if (isActive !== undefined) article.isActive = Boolean(isActive);

    // Keep title in sync
    article.title = article.directoryType === "person"
      ? (article.personName || article.department)
      : (article.department || article.title);

    await article.save();
    res.json(omitFileData(article));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}
