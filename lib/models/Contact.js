import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const ContactSchema = new Schema(
  {
    name:        { type: String, required: true, trim: true },
    phone:       { type: String, default: "—" },
    email:       { type: String, default: "—" },
    tag:         { type: String, default: "Lead" },
    lastCall:    { type: String, default: "—" },
    notes:       { type: String, default: "" },
    company:     { type: String, default: "" },
    position:    { type: String, default: "" },
    address:     { type: String, default: "" },
    website:     { type: String, default: "" },
    socialMedia: { type: Schema.Types.Mixed, default: {} },
    isActive:    { type: Boolean, default: true },
    userId:      { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

ContactSchema.index({ userId: 1, createdAt: -1 });

export default models.Contact || model("Contact", ContactSchema);
