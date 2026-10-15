import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const UserSettingsSchema = new Schema(
  {
    defaultAgent: String,
    agentSettings: {
      reschedule: Boolean,
      voicemail: Boolean,
    },
    voiceSettings: {
      voice: String,
      speed: Number,
    },
    callSettings: {
      recordCalls: Boolean,
      aiSummary: Boolean,
      retryMissed: Boolean,
    },
    notificationSettings: {
      callFailed: Boolean,
      dailySummary: Boolean,
      pushCompletion: Boolean,
    },
  },
  { _id: false }
);

const UserSchema = new Schema(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true, select: false },
    role:     { type: String, enum: ["user", "admin"], default: "user" },
    avatar:   { type: String, default: "" },
    phone:    { type: String, default: "" },
    bio:      { type: String, default: "" },
    timezone: { type: String, default: "UTC" },
    language: { type: String, default: "en" },
    settings: { type: UserSettingsSchema, default: () => ({}) },
  },
  { timestamps: true, versionKey: false }
);

UserSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

export default models.User || model("User", UserSchema);
