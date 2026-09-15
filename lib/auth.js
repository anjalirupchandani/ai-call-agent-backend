// lib/auth.js — MongoDB-backed auth using User model

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "./models/User.js";

const JWT_SECRET     = process.env.JWT_SECRET || "local_dev_secret_change_before_deploy";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function signToken(user) {
  return jwt.sign({ sub: user._id.toString() }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function signup({ name, email, password }) {
  if (!name || !email || !password)
    throw Object.assign(new Error("name, email and password are all required."), { status: 400 });
  if (password.length < 8)
    throw Object.assign(new Error("Password must be at least 8 characters."), { status: 400 });

  const existing = await User.findOne({ email: email.trim().toLowerCase() });
  if (existing)
    throw Object.assign(new Error("An account with that email already exists."), { status: 409 });

  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({ name: name.trim(), email: email.trim().toLowerCase(), password: hash });

  return { token: signToken(user), user };
}

export async function login({ email, password }) {
  if (!email || !password)
    throw Object.assign(new Error("email and password are required."), { status: 400 });

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select("+password");
  if (!user) throw Object.assign(new Error("Invalid email or password."), { status: 401 });

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw Object.assign(new Error("Invalid email or password."), { status: 401 });

  return { token: signToken(user), user };
}

export async function getUserById(id) {
  const user = await User.findById(id);
  if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
  return user;
}
