// controllers/dashboardController.js — MongoDB-backed
// Repurposed for the real-time voice agent: stats are about conversations and
// the Q&A knowledge base, not phone calls. The route names and the
// settings/preferences helpers are unchanged so routes/dashboard.js keeps working.
import Conversation from "../lib/models/Conversation.js";
import KnowledgeArticle from "../lib/models/KnowledgeArticle.js";
import Notification from "../lib/models/Notification.js";
import {
  getDashboardSettings,
  updateDashboardSettings,
  updateDashboardPreferences,
  clearDashboardCache,
} from "../lib/datastore.js";

function dayKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function dayLabel(d, dayCount) {
  const date = new Date(d);
  if (dayCount === 1) return "Today";
  if (dayCount === 7) return date.toLocaleDateString("en-US", { weekday: "short" });
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// GET /api/dashboard/stats?period=today|7d|30d
export async function getStats(req, res) {
  try {
    const period = ["today", "7d", "30d"].includes(req.query.period) ? req.query.period : "7d";
    const dayCount = period === "today" ? 1 : period === "30d" ? 30 : 7;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - dayCount + 1);

    const [conversations, kbEntries, activeKb, qaEntries] = await Promise.all([
      Conversation.find({ userId: req.userId, createdAt: { $gte: since } })
        .select("status messageCount durationSeconds createdAt"),
      KnowledgeArticle.countDocuments({ userId: req.userId }),
      KnowledgeArticle.countDocuments({ userId: req.userId, isActive: { $ne: false } }),
      KnowledgeArticle.countDocuments({ userId: req.userId, entryType: "qa", isActive: { $ne: false } }),
    ]);

    const totalConversations = conversations.length;
    const completedConversations = conversations.filter((c) => c.status === "Completed").length;
    const totalMessages = conversations.reduce((sum, c) => sum + (c.messageCount || 0), 0);
    const totalSeconds = conversations.reduce((sum, c) => sum + (c.durationSeconds || 0), 0);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);

    const buckets = Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(since);
      date.setDate(since.getDate() + index);
      return {
        day: dayLabel(date, dayCount),
        dateKey: dayKey(date),
        conversations: 0,
        messages: 0,
      };
    });

    conversations.forEach((c) => {
      const bucket = buckets.find((b) => b.dateKey === dayKey(c.createdAt));
      if (!bucket) return;
      bucket.conversations += 1;
      bucket.messages += c.messageCount || 0;
    });

    res.json({
      stats: {
        totalConversations,
        completedConversations,
        totalMessages,
        avgMessagesPerConversation: totalConversations
          ? (totalMessages / totalConversations).toFixed(1)
          : "0",
        totalTalkTime: totalSeconds > 0 ? `${hrs}h ${String(mins).padStart(2, "0")}m` : "0m",
        kbEntries,
        activeKbEntries: activeKb,
        qaEntries,
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
    const [conversations, kbEntries, qaEntries] = await Promise.all([
      Conversation.find({ userId: req.userId }).select("status messageCount createdAt").sort({ createdAt: -1 }).limit(100),
      KnowledgeArticle.countDocuments({ userId: req.userId }),
      KnowledgeArticle.countDocuments({ userId: req.userId, entryType: "qa" }),
    ]);

    const total = conversations.length;
    const completed = conversations.filter((c) => c.status === "Completed").length;
    const totalMessages = conversations.reduce((sum, c) => sum + (c.messageCount || 0), 0);

    const statusMap = {};
    conversations.forEach((c) => { statusMap[c.status] = (statusMap[c.status] || 0) + 1; });
    const statusDistribution = Object.entries(statusMap).map(([status, count]) => ({ status, count }));

    // Conversation volume (by messages) for the last 7 days.
    const now = new Date();
    const volumeMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      volumeMap[d.toLocaleDateString("en-US", { month: "short", day: "numeric" })] = 0;
    }
    conversations.forEach((c) => {
      const label = new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (label in volumeMap) volumeMap[label] += c.messageCount || 0;
    });
    const conversationVolume = Object.entries(volumeMap).map(([date, count]) => ({ date, count }));

    const recentActivity = await Notification.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("title message type createdAt");

    res.json({
      summary: { totalConversations: total, completedConversations: completed, totalMessages, kbEntries, qaEntries },
      statusDistribution,
      conversationVolume,
      recentActivity,
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// GET /api/dashboard/recent
export async function getRecent(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 10;
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
    const limit = parseInt(req.query.limit) || 20;
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
    defaultView: defaultView || "grid",
    refreshInterval: refreshInterval || 30000,
    showRecentActivity: showRecentActivity ?? true,
    showStats: showStats ?? true,
    chartType: chartType || "bar",
    theme: theme || "light",
  });
  res.json({ message: "Dashboard settings updated successfully", settings: updated });
}

// PUT /api/dashboard/preferences
export function updatePreferences(req, res) {
  const { widgetOrder, collapsedWidgets, dateRange, metrics } = req.body;
  const updated = updateDashboardPreferences(String(req.userId), {
    widgetOrder: widgetOrder || ["stats", "activity", "insights"],
    collapsedWidgets: collapsedWidgets || [],
    dateRange: dateRange || "7d",
    metrics: metrics || ["conversations", "knowledge"],
  });
  res.json({ message: "Dashboard preferences updated successfully", preferences: updated });
}

// DELETE /api/dashboard/cache
export function clearCache(req, res) {
  clearDashboardCache(String(req.userId));
  res.json({ message: "Dashboard cache cleared successfully" });
}
