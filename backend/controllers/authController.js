import pool from "../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export const register = async (req,res)=>{

 const {email,password} = req.body;

 try{

  const hash = await bcrypt.hash(password,10);

  await pool.query(
   "INSERT INTO users (email,password) VALUES (?,?)",
   [email,hash]
  );

  res.json({message:"User created"});

 }catch(err){

  res.status(500).json({error:err.message});

 }

};

export const login = async (req,res)=>{

 const {email,password} = req.body;

 try{

  const [rows] = await pool.query(
   "SELECT * FROM users WHERE email=?",
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

  const token = jwt.sign(
   {id:user.id},
   "SECRET",
   {expiresIn:"7d"}
  );

  res.json({token});

 }catch(err){

  res.status(500).json({error:err.message});

 }

};