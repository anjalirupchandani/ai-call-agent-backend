// routes/contacts.js
import { Router } from "express";
import {
  listContacts,
  getContactByPhoneHandler,
  getContact,
  createContact,
  updateContact,
  deleteContacts,
  deleteContact,
  toggleContact,
  updateContactLastCall,
} from "../controllers/contactController.js";

const router = Router();

router.get("/", listContacts);
router.get("/phone/:phone", getContactByPhoneHandler); // must be before /:id
router.get("/:id", getContact);
router.post("/", createContact);
router.put("/:id", updateContact);
router.delete("/", deleteContacts); // bulk
router.delete("/:id", deleteContact);
router.patch("/:id/toggle", toggleContact);
router.patch("/:id/lastcall", updateContactLastCall);

export default router;
