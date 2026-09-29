// lib/models/Call.js
import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const CallSchema = new Schema(
  {
    // Provider call ID. For Edesy calls this is the Edesy `conversationId`.
    executionId:  { type: String, default: "" },
    contact:      { type: String, default: "Unknown" },
    phone:        { type: String, required: true },
    purpose:      { type: String, default: "" },
    status:       { type: String, default: "In Progress" },
    duration:     { type: String, default: "0:00" },
    type:         { type: String, default: "Outbound" },
    agent:        { type: String, default: "Local AI Agent" },
    summary:      { type: String, default: "" },
    transcript:   { type: Array,  default: [] },
    insights:     { type: Array,  default: [] },
    followUp:     { type: String, default: "" },
    recordingUrl: { type: String, default: "" },

    // Selected Pathway (loaded, validated and compiled into Edesy variables
    // by controllers/callController.js before the call is placed).
    pathwayId:    { type: Schema.Types.ObjectId, ref: "Pathway", default: null },
    pathwayName:  { type: String, default: "" },

    leadScore:        { type: Number },
    customerIntent:   { type: String, default: "" },
    goalAlignment:    { type: String, default: "" },
    nextActions:      { type: Array,  default: [] },

    // ── Edesy ────────────────────────────────────────────────────────────────
    // "edesy" for calls placed through Edesy; empty for older calls.
    provider:        { type: String, default: "" },
    // Raw Edesy status: "initiated" | "in-progress" | "completed" | ...
    providerStatus:  { type: String, default: "" },
    // Edesy agent that placed the call (a numeric ID stored as a string — not a secret).
    providerAgentId: { type: String, default: "" },
    // Telephony provider's call identifier.
    callSid:         { type: String, default: "" },
    // Outcome classification, e.g. QUALIFIED / NO_ANSWER / VOICEMAIL.
    disposition:     { type: String, default: "" },

    userId:       { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

// Calls are looked up by provider call ID on every status poll.
CallSchema.index({ executionId: 1 });

export default models.Call || model("Call", CallSchema);