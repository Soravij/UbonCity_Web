import { useState } from "react";

export default function PlaceForm(){

 const [form,setForm] = useState({
  lang:"th",
  title:"",
  description:"",
  en:{},
  zh:{}
 });

 const autoTranslate = async ()=>{

  const res = await fetch("http://localhost:5000/api/translate",{
    method:"POST",
    headers:{ "Content-Type":"application/json"},
    body:JSON.stringify({
      sourceLang:form.lang,
      title:form.title,
      description:form.description
    })
  });

  const data = await res.json();

  setForm({
   ...form,
   en:data.en,
   zh:data.zh
  });

 };

 return(

  <div>

   <select
    onChange={(e)=>setForm({...form,lang:e.target.value})}
   >

    <option value="th">Thai</option>
    <option value="en">English</option>
    <option value="zh">Chinese</option>

   </select>

   <input
    placeholder="Title"
    onChange={(e)=>setForm({...form,title:e.target.value})}
   />

   <textarea
    placeholder="Description"
    onChange={(e)=>setForm({...form,description:e.target.value})}
   />

   <button onClick={autoTranslate}>
    Auto Translate
   </button>

  </div>

 )

}