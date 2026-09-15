import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const ScheduledCallSchema = new Schema(
  {
    userId:      { type: Schema.Types.ObjectId, ref: "User", required: true },
    contactId:   { type: Schema.Types.ObjectId, ref: "Contact", default: null },
    phoneNumber: { type: String, required: true, trim: true },
    name:        { type: String, trim: true, default: "" },
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "cancelled"],
      default: "pending",
    },
    notes:      { type: String, default: "" },
    agentId:    { type: String, default: "" },
    callId:     { type: String, default: "" },
    duration:   { type: Number, default: 0 },
    recording:  { type: String, default: "" },
    transcript: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

ScheduledCallSchema.index({ userId: 1, scheduledAt: 1 });
ScheduledCallSchema.index({ userId: 1, status: 1 });

export default models.ScheduledCall || model("ScheduledCall", ScheduledCallSchema);
