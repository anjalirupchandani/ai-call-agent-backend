import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// Nodes/edges are stored as loose Mixed data — their shape is owned by the
// frontend canvas (React Flow-style { id, type, position, data }) and we
// don't want the backend schema to fight with it as node types evolve.
const PathwaySchema = new Schema(
  {
    name:   { type: String, required: true, trim: true, default: "agent" },
    nodes:  { type: [Schema.Types.Mixed], default: [] },
    edges:  { type: [Schema.Types.Mixed], default: [] },
    status: { type: String, enum: ["draft", "deployed"], default: "draft" },
    // The Cognidom agent (configured in the Cognidom dashboard) that this
    // pathway's logic has been built into. Calls started against this
    // pathway are routed to this agentId — see lib/cognidom.js for why.
    cognidomAgentId: { type: String, trim: true, default: "" },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

PathwaySchema.index({ userId: 1, createdAt: -1 });

export default models.Pathway || model("Pathway", PathwaySchema);