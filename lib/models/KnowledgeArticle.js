import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// entryType drives how an article is stored and matched:
//   "qa"        → a manually entered Question + Answer pair (with phrasing variations)
//   "directory" → a person or department entry used for meeting / routing queries
//   "document"  → an uploaded file whose extracted text the agent can search
//   "website"   → a fetched web page whose text the agent can search
const KnowledgeArticleSchema = new Schema(
  {
    entryType: { type: String, enum: ["qa", "directory", "document", "website"], default: "qa" },

    // ── Used by every entry type ──────────────────────────────────────────────
    title:    { type: String, required: true, trim: true },
    // For document/website: the searchable extracted text.
    // For qa: left blank (the searchable text comes from `question` + `variations`).
    content:  { type: String, default: "" },
    category: {
      type: String,
      default: "general",
      enum: [
        "general",
        "hours",
        "location",
        "contact",
        "services",
        "appointments",
        "team",
        "pricing",
        "policies",
        // Legacy values kept so older entries still validate.
        "faq",
        "company",
        "product",
        "policy",
        "support",
      ],
    },

    // ── Q&A only ──────────────────────────────────────────────────────────────
    // The question, in the owner's own words. This is what spoken queries are
    // matched against (together with `variations`).
    question:   { type: String, default: "", trim: true },
    // The exact answer the agent should speak when this entry matches.
    answer:     { type: String, default: "", trim: true },
    // Alternative ways a person might ask the same question. Each one is added
    // to the searchable text so natural variations of the question still match.
    variations: { type: [String], default: [] },
    // Optional language tag (en | hi | gu). When a conversation is in a given
    // language, entries in that language are preferred during matching.
    language:   { type: String, default: "", enum: ["", "en", "hi", "gu"] },

    // ── Directory only (person or department) ─────────────────────────────────
    // directoryType: "person" or "department"
    directoryType:  { type: String, default: "", enum: ["", "person", "department"] },
    // For a person: their full name exactly as it should be recognised.
    personName:     { type: String, default: "", trim: true },
    // Name aliases / nicknames / common mispronunciations (one per entry).
    nameAliases:    { type: [String], default: [] },
    // Designation / job title, e.g. "Director", "HR Manager", "Team Lead".
    designation:    { type: String, default: "", trim: true },
    // Department this person belongs to, e.g. "HR", "Accounts", "Technical".
    department:     { type: String, default: "", trim: true },
    // Physical location: cabin number, floor, wing, etc.
    cabin:          { type: String, default: "", trim: true },
    // Free-text extra guidance for the receptionist, e.g. "Call extension 201 to announce visitors."
    directoryNotes: { type: String, default: "", trim: true },
    // For interview / recruitment: is this person an interviewer?
    isInterviewer:  { type: Boolean, default: false },

    // ── Document / website only ──────────────────────────────────────────────
    fileName: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    fileType: { type: String, default: "" },
    sourceType: { type: String, enum: ["document", "website"], default: "document" },
    sourceUrl: { type: String, default: "" },
    // Raw file stored as base64 so it can be downloaded later
    fileData: { type: String, default: "" },

    isActive: { type: Boolean, default: true },
    userId:   { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

// Speed up per-user listing/filtering.
KnowledgeArticleSchema.index({ userId: 1, entryType: 1, createdAt: -1 });

export default models.KnowledgeArticle || model("KnowledgeArticle", KnowledgeArticleSchema);
