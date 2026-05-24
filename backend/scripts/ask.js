import fs from "fs/promises";
import path from "path";
import os from "os";
import OpenAI from "openai";
import dotenv from "dotenv";
import readline from "readline/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const askScriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(askScriptPath);
const backendRoot = path.resolve(scriptDir, "..");
dotenv.config({ path: path.join(backendRoot, ".env") });
dotenv.config();
const configuredProjectRoot = String(process.env.AI_PROJECT_ROOT || process.env.ASK_ROOT || "").trim();
let projectRoot = configuredProjectRoot
  ? path.resolve(configuredProjectRoot)
  : backendRoot;
let defaultModel = process.env.OPENAI_MODEL_ASK || process.env.OPENAI_MODEL || "gpt-5.5";
const rawMaxChars = Number(process.env.BACKEND_ASK_MAX_CHARS || 120000);
const maxChars = Number.isFinite(rawMaxChars) && rawMaxChars > 2000 ? rawMaxChars : 120000;
const execFileAsync = promisify(execFile);
const presetModes = new Set(["review", "plan", "fix", "test"]);

function resolveApiKey() {
  return String(process.env.OPENAI_API_KEY_ASK || process.env.OPENAI_API_KEY || "").trim();
}

function resolveDefaultModel() {
  return String(process.env.OPENAI_MODEL_ASK || process.env.OPENAI_MODEL || defaultModel || "gpt-5.5").trim() || "gpt-5.5";
}

const ignoredDirs = new Set(["node_modules", "uploads", "runtime", ".git"]);
const ignoredFiles = new Set([".env", "package-lock.json"]);
const allowedExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".sql",
  ".yml",
  ".yaml",
]);

function parseArgs(argv) {
  const result = {
    mode: "analyze",
    promptParts: [],
    targets: [],
    preset: null,
    promptFile: null,
    yes: false,
    projectRoot: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--mode") {
      result.mode = (argv[i + 1] || "analyze").toLowerCase();
      i += 1;
      continue;
    }

    if (arg === "--path") {
      const value = argv[i + 1];
      if (value) {
        result.targets.push(value);
      }
      i += 1;
      continue;
    }

    if (arg === "--prompt") {
      const value = argv[i + 1];
      if (value) {
        result.promptParts.push(value);
      }
      i += 1;
      continue;
    }

    if (arg === "--prompt-file") {
      const value = argv[i + 1];
      if (value) {
        result.promptFile = value;
      }
      i += 1;
      continue;
    }

    if (arg === "--yes") {
      result.yes = true;
      continue;
    }

    if (arg === "--project-root") {
      const value = argv[i + 1];
      if (value) {
        result.projectRoot = value;
      }
      i += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }

    if (!arg.startsWith("--") && !result.preset && presetModes.has(arg.toLowerCase())) {
      result.preset = arg.toLowerCase();
      continue;
    }

    if (arg.startsWith("--")) {
      continue;
    }

    result.promptParts.push(arg);
  }

  result.prompt = result.promptParts.join(" ").trim();
  return result;
}

async function readStdinText() {
  if (process.stdin.isTTY) {
    return "";
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }

  return chunks.join("").trim();
}

async function readPromptFromFile(promptFile) {
  if (!promptFile) {
    return "";
  }

  if (promptFile === "-") {
    return readStdinText();
  }

  const absolute = path.resolve(process.cwd(), promptFile);
  return (await fs.readFile(absolute, "utf8")).trim();
}

function normalizeRelPath(inputPath) {
  return inputPath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function resolveTargetPath(target) {
  const absolute = path.resolve(projectRoot, target);
  const normalizedRoot = projectRoot.endsWith(path.sep) ? projectRoot : `${projectRoot}${path.sep}`;

  if (absolute !== projectRoot && !absolute.startsWith(normalizedRoot)) {
    throw new Error(`Target path escapes project root: ${target}`);
  }

  return absolute;
}

function buildAllowedWriteRoots(targets) {
  if (!targets.length) {
    return [projectRoot];
  }

  return [...new Set(targets.map((target) => resolveTargetPath(target)))];
}

function isPathWithinRoot(absolutePath, rootPath) {
  const normalizedRoot = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;
  return absolutePath === rootPath || absolutePath.startsWith(normalizedRoot);
}

function assertPathWithinAllowedTargets(targetPath, allowedRoots) {
  const absolutePath = resolveTargetPath(targetPath);
  const isAllowed = allowedRoots.some((rootPath) => isPathWithinRoot(absolutePath, rootPath));

  if (!isAllowed) {
    throw new Error(`Change path is outside allowed targets: ${targetPath}`);
  }

  return absolutePath;
}

function extractDiffPaths(diffText) {
  const paths = new Set();
  const lines = diffText.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) {
      paths.add(match[1]);
      paths.add(match[2]);
    }
  }

  return [...paths].map((entry) => entry.replace(/^\.\/+/, ""));
}

function previewText(text, maxLength = 300) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function detectPatchFormat(text) {
  const value = String(text || "");
  if (/\bdiff --git a\/.+ b\/.+/m.test(value)) {
    return "git_diff";
  }
  if (/^---\s+\S+/m.test(value) && /^\+\+\+\s+\S+/m.test(value)) {
    return "unified_diff";
  }
  if (/^\*\*\* Begin Patch/m.test(value)) {
    return "begin_patch";
  }
  return "unknown";
}

function extractFromFencedBlocks(responseText) {
  const matches = String(responseText || "").matchAll(/```(?:diff|patch)?\s*([\s\S]*?)```/g);
  for (const match of matches) {
    const block = String(match?.[1] || "").trim();
    const format = detectPatchFormat(block);
    if (format === "git_diff" || format === "unified_diff" || format === "begin_patch") {
      return { format, text: block };
    }
  }
  return null;
}

function extractTopLevelUnifiedDiff(responseText) {
  const text = String(responseText || "");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (/^---\s+\S+/.test(lines[i]) && /^\+\+\+\s+\S+/.test(lines[i + 1])) {
      const candidate = lines.slice(i).join("\n").trim();
      if (detectPatchFormat(candidate) === "unified_diff") {
        return { format: "unified_diff", text: candidate };
      }
    }
  }
  return null;
}

function extractPatchCandidate(responseText) {
  const raw = String(responseText || "");

  const diffIndex = raw.search(/^diff --git a\/.+ b\/.+$/m);
  if (diffIndex >= 0) {
    const candidate = raw.slice(diffIndex).trim();
    return { format: "git_diff", text: candidate };
  }

  const fenced = extractFromFencedBlocks(raw);
  if (fenced) {
    return fenced;
  }

  const unified = extractTopLevelUnifiedDiff(raw);
  if (unified) {
    return unified;
  }

  if (detectPatchFormat(raw) === "begin_patch") {
    throw new Error(
      `Unsupported patch format: begin_patch. Supported formats: diff --git, fenced diff, unified diff. Response preview: ${previewText(raw)}`
    );
  }

  throw new Error(
    `No supported patch block found. Searched for diff --git, fenced diff/patch blocks, and unified diff (---/+++). Response preview: ${previewText(raw)}`
  );
}

function validatePatchCandidate(patchText, relativePath) {
  const text = String(patchText || "").trim();
  const hasHunk = /^@@ /m.test(text);
  const hasGitHeader = /^diff --git a\/.+ b\/.+$/m.test(text);
  const hasOldHeader = /^---\s+\S+/m.test(text);
  const hasNewHeader = /^\+\+\+\s+\S+/m.test(text);
  const hasUnifiedHeaders = hasOldHeader && hasNewHeader;

  if (hasHunk && !hasGitHeader && !hasUnifiedHeaders) {
    throw new Error(
      `Model returned a hunk fragment without file headers for ${relativePath}. Expected diff --git and ---/+++ before @@. Preview: ${previewText(text)}`
    );
  }

  if (hasGitHeader && !hasUnifiedHeaders) {
    throw new Error(
      `Git diff for ${relativePath} is missing ---/+++ headers. Preview: ${previewText(text)}`
    );
  }
}

function containsUnicodeReplacementChar(text) {
  return String(text || "").includes("\uFFFD");
}

function extractApplyFailureLineNumber(message) {
  const match = String(message || "").match(/line\s+(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function buildPatchContext(text, lineNumber, radius = 3) {
  const lines = String(text || "").split(/\r?\n/);
  if (!lineNumber || lineNumber < 1 || lineNumber > lines.length) {
    return lines.slice(0, Math.min(lines.length, 12)).map((line, index) => `${index + 1}: ${line}`).join("\n");
  }

  const start = Math.max(0, lineNumber - 1 - radius);
  const end = Math.min(lines.length, lineNumber + radius);
  return lines.slice(start, end).map((line, index) => `${start + index + 1}: ${line}`).join("\n");
}

function logPatchFailureDiagnostics(message, patchFile, patchText) {
  const lineNumber = extractApplyFailureLineNumber(message);
  console.log("\n=== Patch diagnostics ===\n");
  console.log(`Patch file: ${patchFile}`);
  console.log(`Patch preview: ${previewText(patchText, 600)}`);
  if (containsUnicodeReplacementChar(patchText)) {
    console.log("Warning: patch contains Unicode replacement characters (U+FFFD), which usually indicates encoding corruption.");
  }
  console.log("\n=== Patch context ===\n");
  console.log(buildPatchContext(patchText, lineNumber));
}

async function runGitApplyWithDiagnostics(patchFile, patchText) {
  try {
    await execFileAsync("git", ["-C", projectRoot, "apply", "--check", "--whitespace=nowarn", patchFile]);
  } catch (error) {
    const message = String(error?.stderr || error?.stdout || error?.message || error);
    logPatchFailureDiagnostics(message, patchFile, patchText);
    throw error;
  }
  await execFileAsync("git", ["-C", projectRoot, "apply", "--whitespace=nowarn", patchFile]);
}

function describeInvalidFixOutput(rawOutput) {
  const trimmed = String(rawOutput || "").trim();
  if (!trimmed) {
    return "Model returned empty output in fix mode. Expected STRICT JSON or a top-level diff.";
  }
  if (trimmed.startsWith("```")) {
    return `Model returned a fenced block in fix mode. Expected STRICT JSON or a top-level diff. Preview: ${previewText(trimmed)}`;
  }
  if (/^(function|const|let|import|export)\b/m.test(trimmed)) {
    return `Model returned source code instead of STRICT JSON or a diff. Preview: ${previewText(trimmed)}`;
  }
  return `Model did not return valid JSON in fix mode and did not start with a supported top-level diff. Preview: ${previewText(trimmed)}`;
}

function logRawModelOutput(rawOutput) {
  console.log("\n=== Raw model output ===\n");
  console.log(rawOutput);
}

async function collectTextFiles(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (fullPath === askScriptPath) {
      continue;
    }

    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        await collectTextFiles(fullPath, files);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (ignoredFiles.has(entry.name)) {
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    const isSpecialProjectFile =
      entry.name === "package.json" ||
      entry.name === ".gitignore" ||
      entry.name === ".env.example";

    if (!isSpecialProjectFile && !allowedExtensions.has(ext)) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

async function listFilesForTargets(targets) {
  if (!targets.length) {
    return collectTextFiles(projectRoot);
  }

  const files = [];
  for (const target of targets) {
    const absolute = resolveTargetPath(target);
    let stat;

    try {
      stat = await fs.stat(absolute);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      await collectTextFiles(absolute, files);
      continue;
    }

    if (stat.isFile()) {
      files.push(absolute);
    }
  }

  return files;
}

async function readSnapshot(targets) {
  const files = await listFilesForTargets(targets);
  const parts = [];
  const included = [];
  let totalChars = 0;
  let truncatedAnyFile = false;
  const hasExplicitTargets = Array.isArray(targets) && targets.length > 0;

  for (let index = 0; index < files.length; index += 1) {
    const filePath = files[index];
    const relativePath = normalizeRelPath(path.relative(projectRoot, filePath));
    let content;

    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const blockPrefix = `### FILE: ${relativePath}\n\`\`\`\n`;
    const blockSuffix = `\n\`\`\`\n`;
    const fullBlock = `${blockPrefix}${content}${blockSuffix}`;
    const remaining = maxChars - totalChars;
    if (remaining <= 0) {
      break;
    }

    const filesLeft = files.length - index;
    const fairShareRemaining = hasExplicitTargets
      ? Math.max(2000, Math.floor(remaining / Math.max(1, filesLeft)))
      : remaining;
    const budgetForThisFile = Math.min(remaining, fairShareRemaining);

    if (fullBlock.length > budgetForThisFile) {
      const availableForContent = budgetForThisFile - blockPrefix.length - blockSuffix.length - 40;
      if (availableForContent <= 0) {
        continue;
      }
      const slicedContent = content.slice(0, availableForContent);
      const truncatedBlock = `${blockPrefix}${slicedContent}\n/* [truncated for size] */${blockSuffix}`;
      included.push(relativePath);
      parts.push(truncatedBlock);
      totalChars += truncatedBlock.length;
      truncatedAnyFile = true;
      continue;
    }

    included.push(relativePath);
    parts.push(fullBlock);
    totalChars += fullBlock.length;
  }

  return {
    included,
    snapshot: parts.join("\n"),
    totalFiles: files.length,
    truncatedAnyFile,
  };
}

function buildPrompt(mode, userPrompt, includedCount, totalFiles) {
  const baseContext = [
    `Files read: ${includedCount}/${totalFiles}`,
    `Mode: ${mode}`,
    `Prompt: ${userPrompt}`,
  ].join("\n");

  if (mode === "fix") {
    return [
      "You are editing code in a local backend project.",
      "Return exactly one of these two formats and nothing else:",
      "1. STRICT JSON only with this shape:",
      `{"summary":"short summary","changes":[{"path":"relative/path","diff":"unified diff text"}]}`,
      "2. A raw top-level diff that starts immediately with diff --git or ---",
      "Rules:",
      "- Use relative paths from the project root.",
      "- Include only files you want to change.",
      "- Provide a complete git-style unified diff text for each file.",
      "- Each changes[i].diff must describe exactly one file.",
      "- If you cannot produce a valid change set, return JSON with an explanatory summary and an empty changes array.",
      "- Never return a hunk fragment that starts at @@ without file headers.",
      "- Every diff must include these headers for that file:",
      "  diff --git a/<path> b/<path>",
      "  --- a/<path>",
      "  +++ b/<path>",
      "- The diff must be applicable with git apply.",
      "- Do not include markdown fences.",
      "- Do not prepend or append explanations, commentary, or headings.",
      "- If you choose JSON, do not write anything outside the JSON object.",
      "- If you choose raw diff, the first non-whitespace characters must be diff --git or ---.",
      "- Mixed prose plus diff output will be rejected.",
      baseContext,
    ].join("\n");
  }

  if (mode === "test") {
    return [
      "You are a connection test for the OpenAI API.",
      "Reply with exactly: OK",
      "Do not add punctuation, markdown, or extra text.",
    ].join("\n");
  }

  if (mode === "review") {
    return [
      "You are reviewing code in a local backend project.",
      "Return concise review findings first. Prioritize bugs, regressions, security issues, and missing tests.",
      "If there are no findings, say so explicitly.",
      baseContext,
    ].join("\n");
  }

  if (mode === "plan") {
    return [
      "You are planning backend work in a local project.",
      "Return a concrete implementation plan, assumptions, and risks.",
      "Do not write code unless the user explicitly asks for it.",
      baseContext,
    ].join("\n");
  }

  return [
    "You are a senior backend engineer. Be direct, do not flatter, and focus on the most important issues first.",
    "If the user asks for analysis, answer with analysis. If the user asks for planning, answer with planning. If the user asks for implementation guidance, answer accordingly.",
    baseContext,
  ].join("\n");
}

async function confirmWrite(changes) {
  console.log("\n=== Planned file writes ===");
  for (const change of changes) {
    console.log(change.path);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await rl.question("\nWrite these files? Type 'y' to continue: ");
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

function isRawDiffResponse(text) {
  const value = String(text || "").trim();
  return value.startsWith("diff --git ") || value.startsWith("--- ");
}

async function applyChanges(changes, allowedRoots) {
  const patches = [];
  for (const change of changes) {
    if (!change || typeof change.path !== "string" || typeof change.diff !== "string") {
      throw new Error("Invalid change entry from model.");
    }

    const relativePath = normalizeRelPath(change.path);
    assertPathWithinAllowedTargets(relativePath, allowedRoots);
    const patchCandidate = extractPatchCandidate(change.diff);
    if (patchCandidate.format === "begin_patch") {
      throw new Error(`Unsupported patch format for ${relativePath}: begin_patch`);
    }

    const normalizedPatch = patchCandidate.text.trimEnd();
    validatePatchCandidate(normalizedPatch, relativePath);
    const diffPaths = extractDiffPaths(normalizedPatch);
    if (!diffPaths.length) {
      if (patchCandidate.format === "unified_diff") {
        const relativeUnixPath = relativePath.replaceAll("\\", "/");
        const possibleTargets = [
          relativeUnixPath,
          `a/${relativeUnixPath}`,
          `b/${relativeUnixPath}`,
          `./${relativeUnixPath}`,
        ];
        const hasTargetPath = possibleTargets.some((targetPath) => normalizedPatch.includes(targetPath));
        if (!hasTargetPath) {
          throw new Error(`Unified diff for ${relativePath} does not reference the target path. Preview: ${previewText(normalizedPatch)}`);
        }
      } else {
        throw new Error(`Could not find diff headers for ${relativePath}. Preview: ${previewText(normalizedPatch)}`);
      }
    }

    for (const diffPath of diffPaths) {
      assertPathWithinAllowedTargets(diffPath, allowedRoots);
    }

    patches.push(normalizedPatch);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-fix-"));
  const patchFile = path.join(tempDir, "changes.patch");
  const patchText = `${patches.join("\n\n").trim()}\n`;

  if (containsUnicodeReplacementChar(patchText)) {
    throw new Error("Patch contains Unicode replacement characters (U+FFFD). Refusing to apply because the diff is likely encoding-corrupted.");
  }

  try {
    await fs.writeFile(patchFile, patchText, "utf8");
    await runGitApplyWithDiagnostics(patchFile, patchText);
    return changes.map((change) => normalizeRelPath(change.path));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function applyRawDiff(diffText, allowedRoots) {
  const patchCandidate = extractPatchCandidate(diffText);
  if (patchCandidate.format === "begin_patch") {
    throw new Error("Unsupported patch format for raw diff: begin_patch");
  }

  const normalizedPatch = patchCandidate.text.trimEnd();
  validatePatchCandidate(normalizedPatch, "(raw diff)");

  const diffPaths = extractDiffPaths(normalizedPatch);
  if (!diffPaths.length) {
    throw new Error(`Could not find diff headers for raw diff. Preview: ${previewText(normalizedPatch)}`);
  }

  for (const diffPath of diffPaths) {
    assertPathWithinAllowedTargets(diffPath, allowedRoots);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-fix-"));
  const patchFile = path.join(tempDir, "changes.patch");
  const patchText = `${normalizedPatch}\n`;

  if (containsUnicodeReplacementChar(patchText)) {
    throw new Error("Patch contains Unicode replacement characters (U+FFFD). Refusing to apply because the diff is likely encoding-corrupted.");
  }

  try {
    await fs.writeFile(patchFile, patchText, "utf8");
    await runGitApplyWithDiagnostics(patchFile, patchText);
    return diffPaths.map((diffPath) => normalizeRelPath(diffPath));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.projectRoot) {
    projectRoot = path.resolve(process.cwd(), args.projectRoot);
  }
  const apiKey = resolveApiKey();
  defaultModel = resolveDefaultModel();
  const mode = args.mode === "analyze" && args.preset ? args.preset : args.mode;
  const allowedWriteRoots = buildAllowedWriteRoots(args.targets);
  const filePrompt = await readPromptFromFile(args.promptFile);
  const stdinPrompt = args.promptFile ? "" : await readStdinText();
  const combinedPrompt = [args.prompt, filePrompt, stdinPrompt].filter(Boolean).join("\n\n").trim();
  const userPrompt =
    combinedPrompt ||
    (mode === "test"
      ? "Reply with exactly OK."
      : 
    (mode === "review"
      ? "Review the selected backend files and call out bugs, regressions, missing tests, and security issues."
      : mode === "plan"
        ? "Plan the selected backend work with concrete implementation steps and risks."
        : mode === "fix"
          ? "Fix the selected backend files with the smallest safe changes."
          : "Analyze the selected backend files and explain the main structure, risks, and what to inspect next."));

  if (args.help) {
    console.log([
      "Usage:",
      "  ai review --path controllers --path services --prompt \"your question\"",
      "  ai plan --path controllers --prompt \"plan this work\"",
      "  ai fix --path controllers --prompt \"fix this bug\"",
      "  cat prompt.txt | ai review --path controllers",
      "  ai fix --path controllers --prompt-file prompt.txt --yes",
      "  ai plan --project-root ../collector --path scripts --prompt \"Create a safe restart script for collector and verify /api/health after restart\"",
      "  node backend/scripts/ask.js fix --project-root ./collector --prompt-file ./collector/tmp/ask_prompt.txt",
      "  ai test",
      "  npm run ai -- review --path controllers --prompt \"your question\"",
      "",
      "Flags:",
      "  --path <file-or-folder> (repeatable)",
      "  --prompt <text>",
      "  --prompt-file <file-or->",
      "  --project-root <folder>",
      "  --mode analyze|review|plan|fix",
      "  --yes (skip confirmation in fix mode)",
    ].join("\n"));
    return;
  }

  if (!apiKey) {
    console.error("Missing OpenAI API key.");
    console.error("Set OPENAI_API_KEY_ASK first, or fall back to OPENAI_API_KEY.");
    process.exit(1);
  }

  const shouldReadFiles = mode !== "test";
  const { included, snapshot, totalFiles, truncatedAnyFile } = shouldReadFiles
    ? await readSnapshot(args.targets)
    : { included: [], snapshot: "", totalFiles: 0, truncatedAnyFile: false };
  const client = new OpenAI({ apiKey });

  const requestInput = shouldReadFiles
    ? (snapshot && snapshot.trim() ? snapshot : userPrompt)
    : userPrompt;

  const response = await client.responses.create({
    model: defaultModel,
    instructions: buildPrompt(mode, userPrompt, included.length, totalFiles),
    input: requestInput,
  });

  console.log("\n=== Ask mode ===");
  console.log(`mode=${mode}`);
  console.log(`model=${defaultModel}`);

  if (shouldReadFiles) {
    console.log("\n=== Included files ===");
    for (const file of included) {
      console.log(file);
    }

    if (included.length < totalFiles) {
      console.log(`\n[truncated] read ${included.length} of ${totalFiles} files due to the size limit`);
    }
    if (truncatedAnyFile) {
      console.log("[notice] one or more files were partially included due to size limits");
    }
  }

  if (mode === "test") {
    console.log(response.output_text.trim());
    return;
  }

  if (mode === "fix") {
    const rawOutput = String(response.output_text || "").trim();
    console.log("\n=== Fix parse stage ===");
    console.log("stage=raw_output");

    if (rawOutput.startsWith("diff ") || rawOutput.startsWith("--- ")) {
      console.log("detected=top_level_diff");
      const diffPaths = extractDiffPaths(rawOutput).map((filePath) => ({ path: normalizeRelPath(filePath) }));

      console.log("\n=== Raw diff output ===\n");
      console.log(rawOutput);

      const shouldWrite =
        args.yes || !process.stdin.isTTY
          ? args.yes
          : await confirmWrite(diffPaths);

      if (!process.stdin.isTTY && !args.yes) {
        throw new Error("Fix mode is running non-interactively. Pass --yes to allow writing files.");
      }

      if (!shouldWrite) {
        console.log("Cancelled. No files were written.");
        return;
      }

      console.log("\n=== Fix apply stage ===");
      console.log("source=top_level_diff");
      const written = await applyRawDiff(rawOutput, allowedWriteRoots);
      console.log("\nWritten files:");
      for (const file of written) {
        console.log(file);
      }
      return;
    }

    let extracted = null;
    try {
      extracted = extractPatchCandidate(rawOutput);
    } catch {
      extracted = null;
    }
    if (extracted?.format === "git_diff" || extracted?.format === "unified_diff") {
      console.log("detected=invalid_mixed_output");
      console.log(`format=${extracted.format}`);
      logRawModelOutput(rawOutput);
      throw new Error(
        "Fix mode rejected mixed output. Return either STRICT JSON only or a top-level diff only; do not wrap or prepend prose around the patch."
      );
    }

    let parsed;
    console.log("detected=json_envelope_attempt");

    try {
      parsed = JSON.parse(rawOutput);
    } catch (error) {
      logRawModelOutput(response.output_text);
      throw new Error(`${describeInvalidFixOutput(rawOutput)} JSON parse error: ${error.message}`);
    }

    const changes = Array.isArray(parsed.changes) ? parsed.changes : [];
    if (!changes.length) {
      console.log("\nNo file changes proposed.");
      if (parsed.summary) {
        console.log(`Summary: ${parsed.summary}`);
      }
      return;
    }

    console.log("\n=== Fix Summary ===\n");
    if (parsed.summary) {
      console.log(parsed.summary);
    }

    const shouldWrite =
      args.yes || !process.stdin.isTTY
        ? args.yes
        : await confirmWrite(changes);

    if (!process.stdin.isTTY && !args.yes) {
      throw new Error("Fix mode is running non-interactively. Pass --yes to allow writing files.");
    }

    if (!shouldWrite) {
      console.log("Cancelled. No files were written.");
      return;
    }

    console.log("\n=== Fix apply stage ===");
    console.log("source=json_envelope");
    const written = await applyChanges(changes, allowedWriteRoots);
    console.log("\nWritten files:");
    for (const file of written) {
      console.log(file);
    }
    return;
  }

  console.log("\n=== Model answer ===\n");
  console.log(response.output_text);
}

main().catch((error) => {
  console.error("ask.js failed:");
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
