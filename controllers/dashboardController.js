// controllers/dashboardController.js — MongoDB-backed
import Call from "../lib/models/Call.js";
import Contact from "../lib/models/Contact.js";
import Template from "../lib/models/Template.js";
import Notification from "../lib/models/Notification.js";
import {
  getDashboardSettings,
  updateDashboardSettings,
  updateDashboardPreferences,
  clearDashboardCache,
} from "../lib/datastore.js";

// GET /api/dashboard/stats
export async function getStats(req, res) {
  try {
    const period = ["today", "7d", "30d"].includes(req.query.period) ? req.query.period : "7d";
    const dayCount = period === "today" ? 1 : period === "30d" ? 30 : 7;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - dayCount + 1);

    const [callList, totalContacts, totalTemplates, activeTemplates] = await Promise.all([
      Call.find({ userId: req.userId, createdAt: { $gte: since } }).select("status duration createdAt"),
      Contact.countDocuments({ userId: req.userId }),
      Template.countDocuments({ userId: req.userId }),
      Template.countDocuments({ userId: req.userId, isActive: true }),
    ]);

    const totalCalls = callList.length;
    const completedCalls = callList.filter((c) => c.status === "Completed").length;
    const successRate = totalCalls ? `${((completedCalls / totalCalls) * 100).toFixed(1)}%` : "0%";
    const totalSecs = callList.reduce((sum, c) => {
      const [m, s] = (c.duration || "0:00").split(":").map(Number);
      return sum + (m || 0) * 60 + (s || 0);
    }, 0);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const buckets = Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(since);
      date.setDate(since.getDate() + index);
      return {
        day: dayCount === 1 ? "Today" : dayCount === 7 ? date.toLocaleDateString("en-US", { weekday: "short" }) : date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        dateKey: date.toISOString().slice(0, 10),
        completed: 0,
        missed: 0,
        failed: 0,
      };
    });

    callList.forEach((call) => {
      const bucket = buckets.find((item) => item.dateKey === new Date(call.createdAt).toISOString().slice(0, 10));
      if (!bucket) return;
      if (call.status === "Completed") bucket.completed += 1;
      if (call.status === "Missed") bucket.missed += 1;
      if (call.status === "Failed") bucket.failed += 1;
    });

    res.json({
      stats: {
        totalCalls,
        completedCalls,
        successRate,
        totalDuration: `${hrs}h ${String(mins).padStart(2, "0")}m`,
        totalContacts,
        totalTemplates,
        activeTemplates,
        totalCallsDelta: "",
        completedCallsDelta: "",
        totalDurationDelta: "",
        successRateDelta: "",
      },
      overview: buckets,
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// GET /api/dashboard/overview
export async function getOverview(req, res) {
  try {
    const [callList, totalContacts, totalTemplates] = await Promise.all([
      Call.find({ userId: req.userId }).select("status duration createdAt").sort({ createdAt: -1 }).limit(100),
      Contact.countDocuments({ userId: req.userId }),
      Template.countDocuments({ userId: req.userId }),
    ]);

    const completed   = callList.filter((c) => c.status === "Completed").length;
    const total       = callList.length;
    const successRate = total ? ((completed / total) * 100).toFixed(1) + "%" : "0%";

    // Status distribution
    const statusMap = {};
    callList.forEach((c) => { statusMap[c.status] = (statusMap[c.status] || 0) + 1; });
    const statusDistribution = Object.entries(statusMap).map(([status, count]) => ({ status, count }));

    // Call volume last 7 days
    const now = new Date();
    const volumeMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      volumeMap[d.toLocaleDateString("en-US", { month: "short", day: "numeric" })] = 0;
    }
    callList.forEach((c) => {
      const label = new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (label in volumeMap) volumeMap[label]++;
    });
    const callVolume = Object.entries(volumeMap).map(([date, count]) => ({ date, count }));

    // Recent activity from notifications
    const recentActivity = await Notification.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("title message type createdAt");

    res.json({
      summary: { totalCalls: total, completedCalls: completed, successRate, totalContacts, totalTemplates },
      statusDistribution,
      callVolume,
      recentActivity,
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// GET /api/dashboard/recent
export async function getRecent(req, res) {
  try {
    const limit    = parseInt(req.query.limit) || 10;
    const activity = await Notification.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("title message type createdAt read");
    res.json(activity);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/dashboard/activity
export async function getActivity(req, res) {
  try {
    const limit  = parseInt(req.query.limit)  || 20;
    const offset = parseInt(req.query.offset) || 0;
    const [activity, total] = await Promise.all([
      Notification.find({ userId: req.userId }).sort({ createdAt: -1 }).skip(offset).limit(limit),
      Notification.countDocuments({ userId: req.userId }),
    ]);
    res.json({ activities: activity, total, limit, offset, hasMore: offset + limit < total });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/dashboard/settings
export function getSettings(req, res) {
  res.json(getDashboardSettings(String(req.userId)));
}

// PUT /api/dashboard/settings
export function updateSettings(req, res) {
  const { defaultView, refreshInterval, showRecentActivity, showStats, chartType, theme } = req.body;
  const updated = updateDashboardSettings(String(req.userId), {
    defaultView:        defaultView        || "grid",
    refreshInterval:    refreshInterval    || 30000,
    showRecentActivity: showRecentActivity ?? true,
    showStats:          showStats          ?? true,
    chartType:          chartType          || "bar",
    theme:              theme              || "light",
  });
  res.json({ message: "Dashboard settings updated successfully", settings: updated });
}

// PUT /api/dashboard/preferences
export function updatePreferences(req, res) {
  const { widgetOrder, collapsedWidgets, dateRange, metrics } = req.body;
  const updated = updateDashboardPreferences(String(req.userId), {
    widgetOrder:      widgetOrder      || ["stats", "activity", "insights"],
    collapsedWidgets: collapsedWidgets || [],
    dateRange:        dateRange        || "7d",
    metrics:          metrics          || ["calls", "contacts", "templates"],
  });
  res.json({ message: "Dashboard preferences updated successfully", preferences: updated });
}

// DELETE /api/dashboard/cache
export function clearCache(req, res) {
  clearDashboardCache(String(req.userId));
  res.json({ message: "Dashboard cache cleared successfully" });
}
