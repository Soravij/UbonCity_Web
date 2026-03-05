import { getPlaces } from "@/lib/api";
import Card from "@/components/Card";

export default async function Activities({ params }) {

 const { lang } = params;

 const data = await getPlaces("activities", lang);

 return (

  <div>

   <h1>Activities</h1>

   {data.items.map(place => (
     <Card key={place.id} place={place} />
   ))}

  </div>

 );

}