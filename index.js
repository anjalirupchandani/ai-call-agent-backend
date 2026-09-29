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
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Middleware
import { requireAuth } from "./middleware/auth.js";

// Controllers (health check only)
import { healthCheck } from "./controllers/webhookController.js";

// Routes
import authRouter from "./routes/auth.js";
import dashboardRouter from "./routes/dashboard.js";
import callsRouter from "./routes/calls.js";
import templatesRouter from "./routes/templates.js";
import contactsRouter from "./routes/contacts.js";
import knowledgeRouter from "./routes/knowledge.js";
import usersRouter from "./routes/users.js";
import scheduledCallsRouter from "./routes/scheduledCalls.js";
import notificationsRouter from "./routes/notifications.js";
import campaignsRouter from "./routes/campaigns.js";
import pathwaysRouter from "./routes/pathways.js";

// ---- App setup ------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 8000;

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
    ],
  })
);

app.options("*", cors());

app.use((req, _res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

app.use(express.json());

// ---- Serve API Explorer UI ------------------------------------------------

app.use(express.static(join(__dirname, "public")));

// ---- Health & misc top-level endpoints ------------------------------------

app.get("/api/health", healthCheck);

// ---- Auth (public) --------------------------------------------------------

app.use("/api/auth", authRouter);

// ---- Protected resource routes --------------------------------------------

app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/calls", requireAuth, callsRouter);
app.use("/api/templates", requireAuth, templatesRouter);
app.use("/api/contacts", requireAuth, contactsRouter);
app.use("/api/knowledge", requireAuth, knowledgeRouter);
app.use("/api/users", requireAuth, usersRouter);
app.use("/api/scheduled-calls", requireAuth, scheduledCallsRouter);
app.use("/api/notifications", requireAuth, notificationsRouter);
app.use("/api/campaigns", requireAuth, campaignsRouter);
app.use("/api/pathways", requireAuth, pathwaysRouter);

// Legacy alias (kept for backwards compatibility — same router)
app.use("/api/call", requireAuth, callsRouter);

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
  console.log(`ℹ️  Provider: Edesy (voice-agent.edesy.in)`);
});

process.on("uncaughtException", (e) =>
  console.error("Uncaught:", e)
);

process.on("unhandledRejection", (e) =>
  console.error("Unhandled:", e)
);