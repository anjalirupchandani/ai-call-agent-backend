// lib/models/Conversation.js
// A real-time voice conversation session between the user and the AI agent.
// Each turn is stored in `transcript` so the dashboard can show live history
// and the agent can keep context (e.g. not repeat the greeting).
import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const TurnSchema = new Schema(
  {
    speaker: { type: String, enum: ["user", "ai"], required: true },
    text: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ConversationSchema = new Schema(
  {
    // A short, opaque id the browser uses to address this session.
    sessionId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    language: { type: String, default: "en", enum: ["en", "hi", "gu"] },
    status: { type: String, default: "Active", enum: ["Active", "Completed"] },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    transcript: { type: [TurnSchema], default: [] },
    summary: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

ConversationSchema.index({ userId: 1, createdAt: -1 });

export default models.Conversation || model("Conversation", ConversationSchema);
