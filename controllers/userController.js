// controllers/userController.js
import bcrypt from "bcryptjs";
import User from "../lib/models/User.js";

// PUT /api/users/profile
export async function updateProfile(req, res) {
  try {
    const { name, email, avatar } = req.body;
    const updates = {};
    if (name?.trim())         updates.name   = name.trim();
    if (email?.trim())        updates.email  = email.trim().toLowerCase();
    if (avatar !== undefined) updates.avatar = avatar;

    if (updates.email) {
      const existing = await User.findOne({ email: updates.email, _id: { $ne: req.userId } });
      if (existing) return res.status(409).json({ message: "That email is already in use." });
    }

    const user = await User.findByIdAndUpdate(req.userId, updates, { new: true });
    if (!user) return res.status(404).json({ message: "User not found." });
    res.json({ message: "Profile updated successfully.", user });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// POST /api/users/change-password
export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: "Current and new password are required." });
    if (newPassword.length < 8)
      return res.status(400).json({ message: "New password must be at least 8 characters." });

    const user = await User.findById(req.userId).select("+password");
    if (!user) return res.status(404).json({ message: "User not found." });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(401).json({ message: "Current password is incorrect." });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: "Password changed successfully." });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}