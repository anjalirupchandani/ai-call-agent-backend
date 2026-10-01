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
      // pending   → waiting for its time
      // calling   → scheduler has claimed it and is placing the call right now
      // completed → the call WAS placed (see Call History / callId for the outcome)
      // failed    → call was not placed; reason is in errorMessage
      // cancelled → cancelled by the user
      enum: ["pending", "calling", "completed", "failed", "cancelled"],
      default: "pending",
    },
    notes:      { type: String, default: "" },
    agentId:    { type: String, default: "" },

    // Pathway the agent must follow on this call (must be deployed). Optional.
    pathwayId:   { type: Schema.Types.ObjectId, ref: "Pathway", default: null },
    pathwayName: { type: String, default: "" },

    // Filled by lib/scheduler.js
    claimedAt:    { type: Date, default: null },
    startedAt:    { type: Date, default: null },
    errorMessage: { type: String, default: "" },

    callId:     { type: String, default: "" },   // Edesy conversationId
    callDbId:   { type: Schema.Types.ObjectId, ref: "Call", default: null },
    duration:   { type: Number, default: 0 },
    recording:  { type: String, default: "" },
    transcript: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

ScheduledCallSchema.index({ userId: 1, scheduledAt: 1 });
ScheduledCallSchema.index({ userId: 1, status: 1 });
// Used by the scheduler on every tick.
ScheduledCallSchema.index({ status: 1, scheduledAt: 1 });

export default models.ScheduledCall || model("ScheduledCall", ScheduledCallSchema);