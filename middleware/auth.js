// middleware/auth.js
import mongoose from "mongoose";
import { verifyToken } from "../lib/auth.js";

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  const queryToken = req.query.token;
  const raw = auth?.startsWith("Bearer ") ? auth.slice(7) : queryToken || null;

  if (!raw) {
    return res.status(401).json({ message: "Authentication required. Please log in." });
  }

  try {
    const payload = verifyToken(raw);
    const id = payload.sub;

    // Reject tokens that contain old in-memory IDs (e.g. "1", "2", "3")
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(401).json({ message: "Session expired. Please log in again." });
    }

    req.userId = new mongoose.Types.ObjectId(id);
    next();
  } catch {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
}
