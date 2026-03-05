import pool from "../config/db.js";

export const getPlaces = async (req, res) => {

 const { category, lang } = req.query;

 const [rows] = await pool.query(
  "SELECT * FROM places WHERE category=? AND lang=?",
  [category, lang]
 );

 res.json({ items: rows });

};

export const createPlace = async (req, res) => {

 const {
  group_id,
  category,
  lang,
  slug,
  title,
  description,
  meta_title,
  meta_description,
  image
 } = req.body;

 await pool.query(
  `INSERT INTO places
  (group_id,category,lang,slug,title,description,meta_title,meta_description,image)
  VALUES (?,?,?,?,?,?,?,?,?)`,
  [
   group_id,
   category,
   lang,
   slug,
   title,
   description,
   meta_title,
   meta_description,
   image
  ]
 );

 res.json({ message: "Created" });

};

export const updatePlace = async (req, res) => {

 const { id } = req.params;
 const { title, description, image } = req.body;

 await pool.query(
  "UPDATE places SET title=?,description=?,image=? WHERE id=?",
  [title, description, image, id]
 );

 res.json({ message: "Updated" });

};

export const deletePlace = async (req, res) => {

 const { id } = req.params;

 await pool.query(
  "DELETE FROM places WHERE id=?",
  [id]
 );

 res.json({ message: "Deleted" });

};