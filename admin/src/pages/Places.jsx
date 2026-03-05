import { useState } from "react"
import { api } from "../api/api"

export default function Places(){

 const [title,setTitle] = useState("")
 const [description,setDescription] = useState("")
 const [category,setCategory] = useState("attractions")
 const [lang,setLang] = useState("th")

 const save = async ()=>{

  await api.post("/places",{

   category,
   lang,
   title,
   description,
   image:"test.jpg"

  })

  alert("saved")

 }

 return(

  <div>

   <h2>Create Place</h2>

   <select onChange={e=>setCategory(e.target.value)}>

    <option value="attractions">Attractions</option>
    <option value="activities">Activities</option>
    <option value="hotels">Hotels</option>
    <option value="cafes">Cafe</option>
    <option value="restaurants">Restaurants</option>
    <option value="transport">Transport</option>

   </select>

   <select onChange={e=>setLang(e.target.value)}>

    <option value="th">TH</option>
    <option value="en">EN</option>
    <option value="zh">ZH</option>

   </select>

   <input
   placeholder="title"
   onChange={e=>setTitle(e.target.value)}
   />

   <textarea
   placeholder="description"
   onChange={e=>setDescription(e.target.value)}
   />

   <button onClick={save}>
   Save
   </button>

  </div>

 )

}