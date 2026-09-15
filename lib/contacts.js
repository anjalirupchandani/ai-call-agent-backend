// lib/contacts.js — MongoDB-backed via Contact model
import Contact from "./models/Contact.js";

export async function getContacts(userId) {
  return Contact.find({ userId }).sort({ createdAt: -1 });
}

export async function getContactById(contactId, userId) {
  if (!contactId) throw Object.assign(new Error("Contact ID is required"), { status: 400 });
  return Contact.findOne({ _id: contactId, userId });
}

export async function getContactByPhone(phone, userId) {
  if (!phone) throw Object.assign(new Error("Phone number is required"), { status: 400 });
  return Contact.findOne({ phone, userId });
}

export async function createContact(data) {
  return Contact.create({
    name:        data.name || "Unknown",
    phone:       data.phone || "—",
    email:       data.email || "—",
    tag:         data.tag || "Lead",
    lastCall:    data.lastCall || "—",
    notes:       data.notes || "",
    company:     data.company || "",
    position:    data.position || "",
    address:     data.address || "",
    website:     data.website || "",
    socialMedia: data.socialMedia || {},
    isActive:    data.isActive !== undefined ? data.isActive : true,
    userId:      data.userId,
  });
}

export async function updateContact(contactId, userId, data) {
  if (!contactId) throw Object.assign(new Error("Contact ID is required"), { status: 400 });
  return Contact.findOneAndUpdate(
    { _id: contactId, userId },
    { $set: data },
    { new: true }
  );
}

export async function deleteContact(contactId, userId) {
  if (!contactId) throw Object.assign(new Error("Contact ID is required"), { status: 400 });
  const result = await Contact.deleteOne({ _id: contactId, userId });
  return result.deletedCount > 0;
}

export async function deleteMultipleContacts(contactIds, userId) {
  if (!contactIds?.length) throw Object.assign(new Error("Contact IDs are required"), { status: 400 });
  const result = await Contact.deleteMany({ _id: { $in: contactIds }, userId });
  return result.deletedCount;
}

export async function toggleContactStatus(contactId, userId) {
  if (!contactId) throw Object.assign(new Error("Contact ID is required"), { status: 400 });
  const contact = await Contact.findOne({ _id: contactId, userId });
  if (!contact) return null;
  contact.isActive = !contact.isActive;
  return contact.save();
}

export async function updateLastCall(contactId, userId, lastCall) {
  if (!contactId) throw Object.assign(new Error("Contact ID is required"), { status: 400 });
  return Contact.findOneAndUpdate(
    { _id: contactId, userId },
    { $set: { lastCall: lastCall || new Date().toISOString() } },
    { new: true }
  );
}

export async function searchContacts(userId, query) {
  if (!query) return getContacts(userId);
  const re = new RegExp(query, "i");
  return Contact.find({
    userId,
    $or: [
      { name: re }, { phone: re }, { email: re },
      { company: re }, { position: re }, { tag: re }, { notes: re },
    ],
  }).sort({ createdAt: -1 });
}
