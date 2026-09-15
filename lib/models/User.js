import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const UserSchema = new Schema(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true, select: false },
    role:     { type: String, enum: ["user", "admin"], default: "user" },
    avatar:   { type: String, default: "" },
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
