import Navbar from "@/components/Navbar";

export default function LangLayout({ children, params }) {

 const { lang } = params;

 return (

  <div>

   <Navbar lang={lang} />

   {children}

  </div>

 );

}