// server/lib/datastore.js
// In-memory store with localStorage-style fallback.
// Used for dashboard settings/preferences that don't need MongoDB.

const store = {
  dashboardSettings:     {},
  dashboardPreferences:  {},
};

// ── Dashboard Settings ──────────────────────────────────────────────────────

export function getDashboardSettings(userId) {
  const id = String(userId);
  if (!store.dashboardSettings[id]) {
    store.dashboardSettings[id] = {
      userId:              id,
      defaultView:         "grid",
      refreshInterval:     30000,
      showRecentActivity:  true,
      showStats:           true,
      chartType:           "bar",
      theme:               "light",
      updatedAt:           new Date().toISOString(),
    };
  }
  return store.dashboardSettings[id];
}

export function updateDashboardSettings(userId, updates) {
  const id = String(userId);
  const existing = getDashboardSettings(id);
  store.dashboardSettings[id] = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  return store.dashboardSettings[id];
}

export function updateDashboardPreferences(userId, preferences) {
  const id = String(userId);
  store.dashboardPreferences[id] = {
    userId: id,
    ...(store.dashboardPreferences[id] || {}),
    ...preferences,
    updatedAt: new Date().toISOString(),
  };
  return store.dashboardPreferences[id];
}

export function clearDashboardCache(userId) {
  const id = String(userId);
  delete store.dashboardSettings[id];
  delete store.dashboardPreferences[id];
  return true;
}

// ── Recent Activity ─────────────────────────────────────────────────────────
// Kept in memory per server restart — can be wired to MongoDB later.

const activityLog = [];

export function logActivity(userId, type, action, data) {
  activityLog.unshift({
    id:          `${type}-${Date.now()}`,
    userId:      String(userId),
    type,
    action,
    data,
    timestamp:   new Date().toISOString(),
  });
  // Keep last 500 entries
  if (activityLog.length > 500) activityLog.splice(500);
}

export function getRecentActivity(userId, limit = 10) {
  return activityLog
    .filter((a) => a.userId === String(userId))
    .slice(0, limit);
}

export function getCallVolumeByDay(userId, days = 7) {
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = d.toLocaleDateString("en-US", { weekday: "short" });
    result.push({ day, calls: 0, completed: 0 });
  }
  return result;
}

export function getStatusDistribution(userId) {
  return {
    completed:  0,
    scheduled:  0,
    cancelled:  0,
    failed:     0,
    inProgress: 0,
  };
}
