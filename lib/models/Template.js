import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const TemplateSchema = new Schema(
  {
    name:       { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ["call", "email", "sms"],
      default: "call",
    },
    content:    { type: String, required: true },
    tags:       { type: [String], default: [] },
    isActive:   { type: Boolean, default: true },
    usageCount: { type: Number, default: 0 },
    userId:     { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

TemplateSchema.index({ userId: 1, createdAt: -1 });

export default models.Template || model("Template", TemplateSchema);
