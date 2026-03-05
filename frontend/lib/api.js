const API = "http://localhost:5000/api";

export async function getPlaces(category, lang) {

  const res = await fetch(
    `${API}/places?category=${category}&lang=${lang}`,
    { cache: "no-store" }
  );

  return res.json();
}