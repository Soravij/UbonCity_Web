import fs from "fs/promises";
import path from "path";

function toStr(value) {
  return String(value ?? "").trim();
}

function csvCell(value) {
  const s = toStr(value);
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export async function writeJson(outDir, items) {
  const filePath = path.join(outDir, "content-import.json");
  await fs.writeFile(filePath, JSON.stringify(items, null, 2), "utf8");
  return filePath;
}

export async function writeCsv(outDir, items) {
  const filePath = path.join(outDir, "content-import.csv");
  const headers = [
    "type",
    "category",
    "lang",
    "title",
    "summary",
    "description",
    "image",
    "slug",
    "meta_title",
    "meta_description",
    "latitude",
    "longitude",
    "google_place_id",
    "map_url",
    "source_name",
    "source_url",
    "tags",
  ];

  const lines = [headers.join(",")];
  for (const item of items) {
    const row = headers.map((h) => {
      const v = h === "tags" ? (Array.isArray(item.tags) ? item.tags.join("|") : "") : (item[h] ?? "");
      return csvCell(v);
    });
    lines.push(row.join(","));
  }

  await fs.writeFile(filePath, lines.join("\n"), "utf8");
  return filePath;
}

export async function writeMarkdown(outDir, items) {
  const filePath = path.join(outDir, "content-import.md");
  const lines = ["# Content Export", "", `Total accepted items: ${items.length}`, ""];

  for (const item of items) {
    lines.push(`## [${String(item.type || "").toUpperCase()}] ${item.title || ""}`);
    lines.push(`- Category: ${item.category || "-"}`);
    lines.push(`- Lang: ${item.lang || "th"}`);
    lines.push(`- Source: ${item.source_name || "-"}`);
    lines.push(`- Source URL: ${item.source_url || "-"}`);
    lines.push(`- Map: ${item.map_url || "-"}`);
    lines.push(`- Coordinates: ${item.latitude ?? "-"}, ${item.longitude ?? "-"}`);
    lines.push(`- Tags: ${Array.isArray(item.tags) ? item.tags.join("|") : "-"}`);
    lines.push("");
    lines.push(item.description || "");
    lines.push("");
  }

  await fs.writeFile(filePath, lines.join("\n"), "utf8");
  return filePath;
}
