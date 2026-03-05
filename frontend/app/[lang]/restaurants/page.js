import { getPlaces } from "@/lib/api";
import Card from "@/components/Card";

export default async function Restaurants({ params }) {

 const { lang } = params;

 const data = await getPlaces("restaurants", lang);

 return (

  <div>

   <h1>Restaurants</h1>

   {data.items.map(place => (
     <Card key={place.id} place={place} />
   ))}

  </div>

 );

}