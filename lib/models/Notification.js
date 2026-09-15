import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const NotificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: [
        "call_completed", "call_failed", "call_scheduled", "call_cancelled",
        "contact_added", "template_created", "knowledge_uploaded", "system",
      ],
      default: "system",
    },
    title:   { type: String, required: true },
    message: { type: String, required: true },
    read:    { type: Boolean, default: false },
    link:    { type: String, default: "" },
    meta:    { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, versionKey: false }
);

export default models.Notification || model("Notification", NotificationSchema);
