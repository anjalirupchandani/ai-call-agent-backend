import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const CallSchema = new Schema(
  {
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
    pathwayId:    { type: Schema.Types.ObjectId, ref: "Pathway" },
    pathwayName:  { type: String, default: "" },
    cognidomAgentId:  { type: String, default: "" },
    leadScore:        { type: Number },
    customerIntent:   { type: String, default: "" },
    goalAlignment:    { type: String, default: "" },
    nextActions:      { type: Array,  default: [] },
    userId:       { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

export default models.Call || model("Call", CallSchema);