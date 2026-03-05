import Link from "next/link";
import LanguageSwitch from "./LanguageSwitch";

export default function Navbar({ lang }) {

  return (

    <nav style={{display:"flex",gap:"20px"}}>

      <Link href={`/${lang}`}>UbonCity</Link>

      <Link href={`/${lang}/attractions`}>Attractions</Link>
      <Link href={`/${lang}/activities`}>Activities</Link>
      <Link href={`/${lang}/hotels`}>Hotels</Link>
      <Link href={`/${lang}/cafes`}>Cafe</Link>
      <Link href={`/${lang}/restaurants`}>Restaurants</Link>
      <Link href={`/${lang}/transport`}>Transport</Link>

      <LanguageSwitch />

    </nav>

  );
}