// lib/models/Pathway.js
import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const PathwaySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      default: "agent",
    },

    nodes: {
      type: [Schema.Types.Mixed],
      default: [],
    },

    edges: {
      type: [Schema.Types.Mixed],
      default: [],
    },

    status: {
      type: String,
      enum: ["draft", "deployed"],
      default: "draft",
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

PathwaySchema.index({ userId: 1, createdAt: -1 });

export default models.Pathway || model("Pathway", PathwaySchema);