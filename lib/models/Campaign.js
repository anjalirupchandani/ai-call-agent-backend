import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const CampaignCallSchema = new Schema(
  {
    contactId:   { type: String, default: "" },
    name:        { type: String, default: "" },
    phoneNumber: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "calling", "completed", "failed", "skipped"],
      default: "pending",
    },
    executionId: { type: String, default: "" },
    attemptedAt: { type: Date, default: null },
    error:       { type: String, default: "" },
  },
  { _id: true, versionKey: false }
);

const CampaignSchema = new Schema(
  {
    userId:        { type: Schema.Types.ObjectId, ref: "User", required: true },
    name:          { type: String, required: true, trim: true },
    templateId:    { type: Schema.Types.ObjectId, ref: "Template", default: null },
    templateName:  { type: String, default: "" },
    agentId:       { type: String, default: "" },
    status: {
      type: String,
      enum: ["draft", "running", "paused", "completed", "cancelled"],
      default: "draft",
    },
    concurrency:   { type: Number, default: 1, min: 1, max: 10 },
    pacingSeconds: { type: Number, default: 5, min: 1 },
    calls:         { type: [CampaignCallSchema], default: [] },
    startedAt:     { type: Date, default: null },
    completedAt:   { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

// Virtual: progress stats
CampaignSchema.virtual("progress").get(function () {
  const calls     = this.calls || [];
  const total     = calls.length;
  const completed = calls.filter((c) => c.status === "completed").length;
  const failed    = calls.filter((c) => c.status === "failed").length;
  const calling   = calls.filter((c) => c.status === "calling").length;
  const pending   = calls.filter((c) => c.status === "pending").length;
  const percent   = total ? Math.round((completed / total) * 100) : 0;
  return { total, completed, failed, calling, pending, percent };
});

CampaignSchema.set("toJSON",   { virtuals: true });
CampaignSchema.set("toObject", { virtuals: true });

export default models.Campaign || model("Campaign", CampaignSchema);
