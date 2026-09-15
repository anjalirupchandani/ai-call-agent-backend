// routes/auth.js
import { Router } from "express";
import { signupHandler, loginHandler, meHandler } from "../controllers/authController.js";

const router = Router();

router.post("/signup", signupHandler);
router.post("/login", loginHandler);
router.get("/me", meHandler);

export default router;
