import fs from "node:fs";

const filepath = "server/index.mjs";
let content = fs.readFileSync(filepath, "utf-8");

const oldStr = `      model: aiConfig.model,
      input: prompt,
      text: { format: { type: "text" } },`;

const newStr = `      model: aiConfig.model,
      messages: [{ role: "user", content: prompt }],`;

if (content.includes(oldStr)) {
  content = content.replace(oldStr, newStr);
  fs.writeFileSync(filepath, content, "utf-8");
  console.log("server/index.mjs: replaced successfully");
} else {
  console.log("server/index.mjs: pattern NOT found - checking exact bytes...");
  const idx = content.indexOf("input: prompt");
  if (idx >= 0) {
    console.log(`Found 'input: prompt' at index ${idx}, surrounding: ${JSON.stringify(content.substring(Math.max(0, idx - 40), idx + 80))}`);
  }
}
