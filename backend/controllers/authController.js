import pool from "../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  canActorManageTargetRole,
  ensureUserLifecycleColumns,
  parseCanonicalRole,
  validateManagedByLifecycle,
} from "../services/userRoleService.js";
import { buildStoredUserProfile, normalizeUserRowProfile } from "../services/userProfileService.js";
import { resolveUserAvatarPublicUrl } from "../services/userAvatarService.js";

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
const JWT_ISSUER = String(process.env.JWT_ISSUER || "uboncity-backend").trim();
const JWT_AUDIENCE_BACKEND = String(process.env.JWT_AUDIENCE_BACKEND || "uboncity-backend").trim();
const JWT_AUDIENCE_COLLECTOR = String(process.env.JWT_AUDIENCE_COLLECTOR || "uboncity-collector").trim();
const CANONICAL_ROLES = new Set(["owner", "admin", "editor", "freelance", "user"]);

function logLifecycleAudit(req, { action, targetUserId, before = null, after = null, metadata = null }) {
  console.info("[user-lifecycle-audit]", {
    action: String(action || "").trim() || "unknown",
    actor_user_id: Number(req.user?.id || 0) || null,
    actor_email: String(req.user?.email || "").trim() || null,
    target_user_id: Number(targetUserId || 0) || null,
    before,
    after,
    metadata,
    at: new Date().toISOString(),
  });
}

function isAdminEmail(email) {
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  return adminEmails.includes(String(email).toLowerCase());
}

function resolveRole(email, dbRole) {
  const normalizedDbRole = String(dbRole || "").toLowerCase();
  if (CANONICAL_ROLES.has(normalizedDbRole)) {
    if (normalizedDbRole === "owner") return "owner";
    if (normalizedDbRole === "admin") return "admin";
    if (normalizedDbRole === "editor") return "editor";
    if (normalizedDbRole === "freelance") return "freelance";
    // Keep ADMIN_EMAILS override minimal: only elevate plain users.
    if (normalizedDbRole === "user" && isAdminEmail(email)) return "admin";
    return "user";
  }

  if (normalizedDbRole) {
    return "";
  }

  // Bootstrap-only fallback when legacy rows have no explicit role yet.
  return isAdminEmail(email) ? "admin" : "user";
}

export const register = async (req,res)=>{

 const {email,password,role} = req.body;

 try{

  await ensureUserLifecycleColumns();

  if (!email || !password) {
   return res.status(400).json({error:"email and password are required"});
  }

  if (String(password).length < 6) {
   return res.status(400).json({error:"password must be at least 6 characters"});
  }

  const [exists] = await pool.query(
   "SELECT id FROM users WHERE email=?",
   [email]
  );

  if(exists.length>0){
   return res.status(409).json({error:"email already exists"});
  }

  const hash = await bcrypt.hash(password,10);
  const normalizedRole = parseCanonicalRole(role, "");
  const actorRole = String(req.user?.role || "").toLowerCase();

  let safeRole = "user";
  if (normalizedRole && canActorManageTargetRole(actorRole, normalizedRole)) {
    safeRole = normalizedRole;
  }

  const autoManagedByUserId = Number(req.user?.id || 0) || null;
  const managedByCheck = await validateManagedByLifecycle(safeRole, autoManagedByUserId);
  if (!managedByCheck.ok) {
   return res.status(400).json({error: managedByCheck.error});
  }

  const profileJson = buildStoredUserProfile(req.body, {
   fallbackDisplayName: String(email || "").trim(),
  });

  await pool.query(
    "INSERT INTO users (email,password,role,managed_by_user_id,profile_json) VALUES (?,?,?,?,?)",
   [email,hash,safeRole,managedByCheck.managedByUserId,profileJson]
  );

  const [createdRows] = await pool.query(
   "SELECT id, email, role, managed_by_user_id, profile_json, avatar_path, avatar_updated_at FROM users WHERE email=? LIMIT 1",
   [email]
  );
  const createdProfile = normalizeUserRowProfile(createdRows?.[0] || null);
  const createdUser = createdRows?.[0]
   ? {
      id: Number(createdRows[0].id || 0),
      email: String(createdRows[0].email || ""),
      role: String(createdRows[0].role || "").toLowerCase(),
      managed_by_user_id: createdRows[0].managed_by_user_id == null ? null : Number(createdRows[0].managed_by_user_id),
      display_name: createdProfile.display_name,
      phone: createdProfile.phone,
      email_alt: createdProfile.email_alt,
      line_id: createdProfile.line_id,
      avatar_path: String(createdRows[0].avatar_path || "").trim() || null,
      avatar_url: resolveUserAvatarPublicUrl(req, createdRows[0].avatar_path),
      avatar_updated_at: createdRows[0].avatar_updated_at || null,
      profile_json: createdProfile.profile_json,
     }
   : null;
  logLifecycleAudit(req, {
   action: "user.register",
   targetUserId: createdUser?.id || null,
   after: createdUser,
   metadata: {
    actor_role: actorRole,
    auto_managed_by_user_id: managedByCheck.managedByUserId,
   },
  });

  res.json({message:"User created"});

 }catch(err){
  console.error("register failed", err);
  res.status(500).json({error:"Internal server error"});

 }

};

export const login = async (req,res)=>{

 const {email,password} = req.body;

 try{

  await ensureUserLifecycleColumns();

  const [rows] = await pool.query(
   "SELECT id,email,password,role,managed_by_user_id,profile_json,avatar_path,avatar_updated_at FROM users WHERE email=?",
   [email]
  );

  if(rows.length===0){
   return res.status(401).json({error:"Invalid credentials"});
  }

  const user = rows[0];

  const match = await bcrypt.compare(password,user.password);

  if(!match){
   return res.status(401).json({error:"Invalid credentials"});
  }

  const role = resolveRole(user.email, user.role);
  const profile = normalizeUserRowProfile(user);
  if (!role) {
   console.error("login failed: invalid stored role", { user_id: user.id, email: user.email, role: user.role });
   return res.status(500).json({error:"Account role is misconfigured"});
  }

  const token = jwt.sign(
   {
    id: user.id,
    email: user.email,
    role,
    display_name: profile.display_name,
    managed_by_backend_user_id: user.managed_by_user_id == null ? null : Number(user.managed_by_user_id),
   },
   JWT_SECRET,
   {
    expiresIn:"7d",
    issuer: JWT_ISSUER,
    audience: [JWT_AUDIENCE_BACKEND, JWT_AUDIENCE_COLLECTOR],
   }
  );

  const hydratedUser = {
   id: Number(user.id || 0),
   email: String(user.email || ""),
   role,
   display_name: profile.display_name,
   phone: profile.phone,
   email_alt: profile.email_alt,
   line_id: profile.line_id,
   avatar_path: String(user.avatar_path || "").trim() || null,
   avatar_url: resolveUserAvatarPublicUrl(req, user.avatar_path),
   avatar_updated_at: user.avatar_updated_at || null,
   profile_json: profile.profile_json,
   managed_by_user_id: user.managed_by_user_id == null ? null : Number(user.managed_by_user_id),
  };

  res.json({
   token,
   role: hydratedUser.role,
   email: hydratedUser.email,
   display_name: hydratedUser.display_name,
   phone: hydratedUser.phone,
   email_alt: hydratedUser.email_alt,
   line_id: hydratedUser.line_id,
   avatar_url: hydratedUser.avatar_url,
   avatar_updated_at: hydratedUser.avatar_updated_at,
   profile_json: hydratedUser.profile_json,
   managed_by_user_id: hydratedUser.managed_by_user_id,
  });

 }catch(err){
  console.error("login failed", err);
  res.status(500).json({error:"Internal server error"});

 }

};

export const me = async (req, res) => {
  const role = String(req.user?.role || "").toLowerCase();
  if (!CANONICAL_ROLES.has(role)) {
    return res.status(401).json({ error: "Invalid token role" });
  }

  try {
    await ensureUserLifecycleColumns();
    const [rows] = await pool.query(
      "SELECT id, email, role, managed_by_user_id, profile_json, avatar_path, avatar_updated_at FROM users WHERE id=? LIMIT 1",
      [Number(req.user?.id || 0) || 0]
    );
    const user = rows?.[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const profile = normalizeUserRowProfile(user);

    const hydratedUser = {
      id: Number(user.id || 0),
      email: String(user.email || ""),
      role,
      display_name: profile.display_name,
      phone: profile.phone,
      email_alt: profile.email_alt,
      line_id: profile.line_id,
      avatar_path: String(user.avatar_path || "").trim() || null,
      avatar_url: resolveUserAvatarPublicUrl(req, user.avatar_path),
      avatar_updated_at: user.avatar_updated_at || null,
      managed_by_user_id: user.managed_by_user_id == null
        ? null
        : Number(user.managed_by_user_id),
      profile_json: profile.profile_json,
    };

    return res.json(hydratedUser);
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
};

