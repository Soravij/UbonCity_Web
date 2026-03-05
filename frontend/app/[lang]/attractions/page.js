import { getPlaces } from "@/lib/api";
import Card from "@/components/Card";

export default async function Attractions({ params }) {

 const { lang } = params;

 const data = await getPlaces("attractions", lang);

 return (

  <div>

   <h1>Attractions</h1>

   {data.items.map(place => (

     <Card key={place.id} place={place} />

   ))}

  </div>

 );

}