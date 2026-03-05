"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

export default function LanguageSwitch(){

 const pathname = usePathname();

 const path = pathname.split("/").slice(2).join("/");

 return(

  <div style={{marginLeft:"auto"}}>

   <Link href={`/th/${path}`}>TH</Link> | 
   <Link href={`/en/${path}`}>EN</Link> | 
   <Link href={`/zh/${path}`}>中文</Link>

  </div>

 )

}