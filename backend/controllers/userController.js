import pool from "../config/db.js";
import bcrypt from "bcryptjs";
import { ensureUserRoleColumn } from "../services/userRoleService.js";

const VALID_ROLES = ["admin", "user"];

function sanitizeRole(role) {
  return VALID_ROLES.includes(role) ? role : "user";
}

export const getUsers = async (req, res) => {
  try {
    await ensureUserRoleColumn();
    const [rows] = await pool.query("SELECT id, email, role FROM users ORDER BY id DESC");
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createUser = async (req, res) => {
  const { email, password, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: "password must be at least 6 characters" });
  }

  try {
    await ensureUserRoleColumn();

    const [exists] = await pool.query("SELECT id FROM users WHERE email=?", [email]);
    if (exists.length > 0) {
      return res.status(409).json({ error: "email already exists" });
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (email,password,role) VALUES (?,?,?)", [email, hash, sanitizeRole(role)]);

    res.json({ message: "User created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateUserRole = async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "role must be admin or user" });
  }

  if (Number(id) === Number(req.user?.id) && role !== "admin") {
    return res.status(400).json({ error: "cannot downgrade your current admin account" });
  }

  try {
    await ensureUserRoleColumn();

    await pool.query("UPDATE users SET role=? WHERE id=?", [role, id]);
    res.json({ message: "Role updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteUser = async (req, res) => {
  const { id } = req.params;

  if (Number(id) === Number(req.user?.id)) {
    return res.status(400).json({ error: "cannot delete current logged in user" });
  }

  try {
    await pool.query("DELETE FROM users WHERE id=?", [id]);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
