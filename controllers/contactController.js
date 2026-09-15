// controllers/contactController.js
//
// Handlers for /api/contacts/* — CRUD, search, and status toggling.
// The actual data access lives in lib/contacts.js; this file is the
// HTTP layer that validates input and shapes responses.

import {
  getContacts,
  getContactById,
  getContactByPhone,
  createContact as createContactRecord,
  updateContact as updateContactRecord,
  deleteContact as deleteContactRecord,
  deleteMultipleContacts,
  toggleContactStatus,
  updateLastCall,
  searchContacts,
} from "../lib/contacts.js";

// GET /api/contacts
export async function listContacts(req, res) {
  try {
    const { search } = req.query;
    const contacts = search
      ? await searchContacts(req.userId, search)
      : await getContacts(req.userId);
    res.json(contacts || []);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// GET /api/contacts/phone/:phone
export async function getContactByPhoneHandler(req, res) {
  try {
    const c = await getContactByPhone(req.params.phone, req.userId);
    if (!c) return res.status(404).json({ message: "Contact not found" });
    res.json(c);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// GET /api/contacts/:id
export async function getContact(req, res) {
  try {
    const c = await getContactById(req.params.id, req.userId);
    if (!c) return res.status(404).json({ message: "Contact not found" });
    res.json(c);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// POST /api/contacts
export async function createContact(req, res) {
  try {
    const { name, phone, email, tag, notes, company, position } = req.body;
    if (!name) return res.status(400).json({ message: "Name is required" });
    res.status(201).json(await createContactRecord({
      name,
      phone: phone || "—",
      email: email || "—",
      tag: tag || "Lead",
      notes: notes || "",
      company: company || "",
      position: position || "",
      userId: req.userId,
    }));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// PUT /api/contacts/:id
export async function updateContact(req, res) {
  try {
    const updated = await updateContactRecord(req.params.id, req.userId, req.body);
    if (!updated) return res.status(404).json({ message: "Contact not found" });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// DELETE /api/contacts (bulk)
export async function deleteContacts(req, res) {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ message: "Contact IDs are required" });
    const count = await deleteMultipleContacts(ids, req.userId);
    res.json({ message: `${count} contacts deleted successfully` });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// DELETE /api/contacts/:id
export async function deleteContact(req, res) {
  try {
    const deleted = await deleteContactRecord(req.params.id, req.userId);
    if (!deleted) return res.status(404).json({ message: "Contact not found" });
    res.json({ message: "Contact deleted successfully" });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// PATCH /api/contacts/:id/toggle
export async function toggleContact(req, res) {
  try {
    const updated = await toggleContactStatus(req.params.id, req.userId);
    if (!updated) return res.status(404).json({ message: "Contact not found" });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

// PATCH /api/contacts/:id/lastcall
export async function updateContactLastCall(req, res) {
  try {
    const updated = await updateLastCall(req.params.id, req.userId, req.body.lastCall);
    if (!updated) return res.status(404).json({ message: "Contact not found" });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}
