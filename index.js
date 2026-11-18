// index.js

import "dotenv/config";
import dns from "node:dns";

// Use reliable public DNS servers for MongoDB Atlas SRV lookup
dns.setServers([
  "8.8.8.8",
  "1.1.1.1",
]);

import express from "express";
import cors from "cors";
import { connectDB } from "./lib/db.js";

// Middleware
import { requireAuth } from "./middleware/auth.js";

// Controllers (health check only)
import { healthCheck } from "./controllers/webhookController.js";

// Routes
import authRouter from "./routes/auth.js";
import dashboardRouter from "./routes/dashboard.js";
import conversationRouter from "./routes/conversation.js";
import knowledgeRouter from "./routes/knowledge.js";
import usersRouter from "./routes/users.js";
import notificationsRouter from "./routes/notifications.js";

// ---- App setup ------------------------------------------------------------

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Connect to database --------------------------------------------------

try {
  await connectDB();
} catch (err) {
  console.error("❌ Database connection error:", err.message);
}

// ---- Global middleware ----------------------------------------------------

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "ngrok-skip-browser-warning",
    ],
  })
);

app.options("*", cors());

app.use((req, _res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

app.use(express.json());

// ---- Health & misc top-level endpoints ------------------------------------

app.get("/api/health", healthCheck);

// ---- Auth (public) --------------------------------------------------------

app.use("/api/auth", authRouter);

// ---- Protected resource routes --------------------------------------------

app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/conversation", requireAuth, conversationRouter);
app.use("/api/knowledge", requireAuth, knowledgeRouter);
app.use("/api/users", requireAuth, usersRouter);
app.use("/api/notifications", requireAuth, notificationsRouter);

// ---- Error handler --------------------------------------------------------

app.use((err, _req, res, _next) => {
  console.error("Server error:", err);

  res.status(500).json({
    message: "Something went wrong!",
  });
});

// ---- Start ----------------------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`ℹ️  Mode: real-time voice agent (browser STT/TTS + Q&A knowledge base)`);
});

process.on("uncaughtException", (e) =>
  console.error("Uncaught:", e)
);

process.on("unhandledRejection", (e) =>
  console.error("Unhandled:", e)
);
