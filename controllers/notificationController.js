// controllers/notificationController.js — MongoDB-backed via Notification model
import Notification from "../lib/models/Notification.js";

// Internal helper used by other controllers
export async function createNotification(userId, { type, title, message, link = "", meta = {} }) {
  try {
    return await Notification.create({ userId, type: type || "system", title, message, read: false, link, meta });
  } catch (err) {
    console.error("[notifications] failed to create:", err.message);
  }
}

// GET /api/notifications
export async function listNotifications(req, res) {
  try {
    const notifications = await Notification.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/notifications/unread-count
export async function getUnreadCount(req, res) {
  try {
    const count = await Notification.countDocuments({ userId: req.userId, read: false });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// PATCH /api/notifications/:id/read
export async function markAsRead(req, res) {
  try {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: { read: true } },
      { new: true }
    );
    if (!n) return res.status(404).json({ message: "Notification not found" });
    res.json(n);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// PATCH /api/notifications/read-all
export async function markAllAsRead(req, res) {
  try {
    await Notification.updateMany({ userId: req.userId, read: false }, { $set: { read: true } });
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// DELETE /api/notifications/:id
export async function deleteNotification(req, res) {
  try {
    const n = await Notification.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!n) return res.status(404).json({ message: "Notification not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// DELETE /api/notifications
export async function clearAllNotifications(req, res) {
  try {
    await Notification.deleteMany({ userId: req.userId });
    res.json({ message: "All notifications cleared" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}
