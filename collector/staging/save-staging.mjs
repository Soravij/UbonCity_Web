import fs from "fs/promises";
import path from "path";

export async function saveStaging(outDir, accepted, rejected) {
  await fs.mkdir(outDir, { recursive: true });

  const acceptedPath = path.join(outDir, "content-import.json");
  const rejectedPath = path.join(outDir, "rejected-items.json");

  await fs.writeFile(acceptedPath, JSON.stringify(accepted, null, 2), "utf8");
  await fs.writeFile(rejectedPath, JSON.stringify(rejected, null, 2), "utf8");

  return { outDir, acceptedPath, rejectedPath };
}
