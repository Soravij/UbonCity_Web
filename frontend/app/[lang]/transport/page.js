import { getPlaces } from "@/lib/api";
import Card from "@/components/Card";

export default async function Transport({ params }) {

 const { lang } = params;

 const data = await getPlaces("transport", lang);

 return (

  <div>

   <h1>Transport</h1>

   {data.items.map(place => (
     <Card key={place.id} place={place} />
   ))}

  </div>

 );

}