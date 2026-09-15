import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const KnowledgeArticleSchema = new Schema(
  {
    title:    { type: String, required: true, trim: true },
    content:  { type: String, default: "" },
    category: {
      type: String,
      default: "faq",
      enum: ["faq", "product", "policy", "pricing", "support"],
    },
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

export default models.KnowledgeArticle || model("KnowledgeArticle", KnowledgeArticleSchema);
