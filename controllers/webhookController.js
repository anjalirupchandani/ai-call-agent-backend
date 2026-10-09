import { isDBConnected } from "../lib/db.js";
// controllers/webhookController.js

// GET /api/health
export function healthCheck(_req, res) {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    database: isDBConnected() ? "connected" : "DISCONNECTED",
    jwtSecretConfigured: !!process.env.JWT_SECRET,
    mode: "local (Edesy for calling)",
  });
}