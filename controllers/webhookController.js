// controllers/webhookController.js

// GET /api/health
export function healthCheck(_req, res) {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    mode: "local (Edesy for calling)",
  });
}