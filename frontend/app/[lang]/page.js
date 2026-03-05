import Navbar from "../../components/Navbar";

export default function Home({ params }) {

 const { lang } = params;

 return (

  <div>

   <Navbar lang={lang} />

   <h1 className="text-4xl p-10">

    Welcome to UbonCity

   </h1>

  </div>

 );

}