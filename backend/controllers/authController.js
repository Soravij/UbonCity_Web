import pool from "../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { ensureUserRoleColumn } from "../services/userRoleService.js";

const JWT_SECRET = process.env.JWT_SECRET || "uboncity_secret";

function isAdminEmail(email) {
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  return adminEmails.includes(String(email).toLowerCase());
}

function resolveRole(email, dbRole) {
  if (isAdminEmail(email)) {
    return "admin";
  }

  return dbRole === "admin" ? "admin" : "user";
}

export const register = async (req,res)=>{

 const {email,password,role} = req.body;

 try{

  await ensureUserRoleColumn();

  const hash = await bcrypt.hash(password,10);
  const safeRole = role === "admin" ? "admin" : "user";

  await pool.query(
   "INSERT INTO users (email,password,role) VALUES (?,?,?)",
   [email,hash,safeRole]
  );

  res.json({message:"User created"});

 }catch(err){

  res.status(500).json({error:err.message});

 }

};

export const login = async (req,res)=>{

 const {email,password} = req.body;

 try{

  await ensureUserRoleColumn();

  const [rows] = await pool.query(
   "SELECT id,email,password,role FROM users WHERE email=?",
   [email]
  );

  if(rows.length===0){
   return res.status(401).json({error:"User not found"});
  }

  const user = rows[0];

  const match = await bcrypt.compare(password,user.password);

  if(!match){
   return res.status(401).json({error:"Wrong password"});
  }

  const role = resolveRole(user.email, user.role);

  const token = jwt.sign(
   {id:user.id,email:user.email,role},
   JWT_SECRET,
   {expiresIn:"7d"}
  );

  res.json({token,role,email:user.email});

 }catch(err){

  res.status(500).json({error:err.message});

 }

};
