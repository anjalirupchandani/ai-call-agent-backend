// controllers/authController.js
import { signup, login, getUserById, verifyToken } from "../lib/auth.js";

export async function signupHandler(req, res) {
  try {
    res.status(201).json(await signup(req.body));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

export async function loginHandler(req, res) {
  try {
    res.json(await login(req.body));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

export async function meHandler(req, res) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ message: "No token" });
  try {
    const payload = verifyToken(auth.slice(7));
    res.json(await getUserById(payload.sub));
  } catch (err) {
    res.status(err.status || 401).json({ message: err.message });
  }
}
