// scripts/reindexKnowledge.js
// One-off backfill: extracts searchable text for Knowledge Base items that were
// uploaded BEFORE text extraction existed (their content is still a placeholder
// such as "[Binary file — application/pdf]"). Safe to run repeatedly.
//
//   npm run kb:reindex
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/db.js";
import KnowledgeArticle from "../lib/models/KnowledgeArticle.js";
import { extractPdfText, extractWebsiteText, isPlaceholderContent } from "../lib/knowledgeText.js";

if (!(await connectDB())) {
  console.error("❌ Could not connect to MongoDB.");
  process.exit(1);
}

const articles = await KnowledgeArticle.find({});
let fixed = 0;
let failed = 0;
let skipped = 0;

for (const a of articles) {
  if (!isPlaceholderContent(a.content)) {
    skipped++;
    continue;
  }
  try {
    let text = "";
    if (a.sourceType === "website" && a.sourceUrl) {
      text = await extractWebsiteText(a.sourceUrl);
    } else if (a.fileType === "application/pdf" && a.fileData) {
      text = await extractPdfText(Buffer.from(a.fileData, "base64"));
    } else {
      console.log(`– "${a.title}": nothing to extract (${a.fileType || a.sourceType})`);
      skipped++;
      continue;
    }
    if (text.length < 50) throw new Error("no readable text found");
    a.content = text;
    await a.save();
    fixed++;
    console.log(`✔ "${a.title}": ${text.length.toLocaleString()} characters`);
  } catch (err) {
    failed++;
    console.log(`✖ "${a.title}": ${err.message}`);
  }
}

console.log(`\nDone. Indexed ${fixed}, failed ${failed}, already fine/skipped ${skipped}.`);
await mongoose.disconnect();
