import jwt from "jsonwebtoken";

export const protect = (req,res,next)=>{

 const authHeader = req.headers.authorization;

 if(!authHeader){
  return res.status(401).json({message:"Not authorized"});
 }

 const token = authHeader.split(" ")[1];

 try{

  const decoded = jwt.verify(token,"uboncity_secret");

  req.user = decoded;

  next();

 }catch(err){

  res.status(401).json({message:"Invalid token"});

 }

}