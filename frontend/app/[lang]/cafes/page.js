import { getPlaces } from "@/lib/api";
import Card from "@/components/Card";

export default async function cafes({ params }) {

 const { lang } = params;

 const data = await getPlaces("cafes", lang);

 return (

  <div>

   <h1>cafes</h1>

   {data.items.map(place => (
     <Card key={place.id} place={place} />
   ))}

  </div>

 );

}