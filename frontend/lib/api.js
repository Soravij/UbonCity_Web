export async function getPlaces(category, lang) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

  try {
    const res = await fetch(
      `${apiUrl}/places?category=${encodeURIComponent(category)}&lang=${encodeURIComponent(lang)}`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

export async function getPlaceDetail(category, slug, lang) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

  try {
    const res = await fetch(
      `${apiUrl}/places/${encodeURIComponent(category)}/${encodeURIComponent(slug)}?lang=${encodeURIComponent(lang)}`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return data?.item || null;
  } catch {
    return null;
  }
}

export async function getEvents() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

  try {
    const res = await fetch(`${apiUrl}/events`, { cache: "no-store" });

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

export async function getEventDetail(id) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

  try {
    const res = await fetch(`${apiUrl}/events/${encodeURIComponent(id)}`, { cache: "no-store" });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return data?.item || null;
  } catch {
    return null;
  }
}
