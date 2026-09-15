// routes/users.js
import { Router } from "express";
import { updateProfile, changePassword } from "../controllers/userController.js";

const router = Router();

router.put("/profile", updateProfile);
router.post("/change-password", changePassword);

export default router;
