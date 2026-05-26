import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const docsDir = path.join(repoRoot, "docs");
const outputDir = path.join(repoRoot, "collector", "server", "public", "uat");

const roleFiles = [
  ["owner", "UAT_ROLE_OWNER_CHECKLIST.md"],
  ["admin", "UAT_ROLE_ADMIN_CHECKLIST.md"],
  ["user", "UAT_ROLE_USER_CHECKLIST.md"],
  ["editor", "UAT_ROLE_EDITOR_CHECKLIST.md"],
  ["freelance", "UAT_ROLE_FREELANCE_CHECKLIST.md"],
];

const runtimeFileName = "uat-interactive-runtime.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

function parseChecklistMarkdown(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");
  const titleLine = lines.find((line) => line.startsWith("# "));
  const title = titleLine ? titleLine.slice(2).trim() : "UAT Checklist";

  const references = [];
  const sections = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (line === "อ้างอิงจาก:") {
      index += 1;
      while (index < lines.length && lines[index].trim().startsWith("- ")) {
        references.push(lines[index].trim().slice(2).trim());
        index += 1;
      }
      continue;
    }

    if (line.startsWith("## ")) {
      const sectionTitle = line.slice(3).trim();
      const content = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("## ")) {
        content.push(lines[index]);
        index += 1;
      }
      sections.push(parseSection(sectionTitle, content));
      continue;
    }
    index += 1;
  }

  return { title, references, sections };
}

function parseSection(title, contentLines) {
  const lines = contentLines.map((line) => line.trim()).filter((line) => line.length > 0);

  if (title === "Metadata") {
    return {
      type: "metadata",
      title,
      fields: lines
        .filter((line) => line.startsWith("- "))
        .map((line) => {
          const raw = line.slice(2);
          const [label, defaultValue = ""] = raw.split(":");
          return {
            label: label.trim(),
            defaultValue: defaultValue.trim().replace(/^_+|_+$/g, ""),
          };
        }),
    };
  }

  if (lines.some((line) => line.startsWith("|"))) {
    return {
      type: "table",
      title,
      table: parseMarkdownTable(lines),
    };
  }

  const decisionLine = lines.find((line) => line.startsWith("- Decision:"));
  const approvedLine = lines.find((line) => line.startsWith("- Approved by:"));
  if (decisionLine || approvedLine) {
    const items = lines
      .filter((line) => line.startsWith("- [ ]"))
      .map((line) => line.replace(/^- \[ \]\s*/, "").trim());
    return {
      type: "decision",
      title,
      items,
      decisionLabel: decisionLine ? decisionLine.replace(/^- /, "") : "Decision",
      approverLabel: approvedLine ? approvedLine.replace(/^- /, "") : "Approved by",
    };
  }

  const checklistItems = lines
    .filter((line) => line.startsWith("- [ ]"))
    .map((line) => line.replace(/^- \[ \]\s*/, "").trim());
  if (checklistItems.length > 0) {
    return {
      type: "checklist",
      title,
      items: checklistItems,
    };
  }

  return {
    type: "notes",
    title,
    lines,
  };
}

function parseMarkdownTable(lines) {
  const tableLines = lines.filter((line) => line.startsWith("|"));
  const rows = tableLines.map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );

  const header = rows[0] ?? [];
  const body = rows
    .slice(2)
    .filter((row) => row.some((cell) => cell.length > 0 || row.length === header.length));

  return { header, rows: body };
}

function buildPageHtml(role, parsed) {
  const body = parsed.sections
    .map((section, sectionIndex) => renderSection(role, section, sectionIndex))
    .join("\n");

  const title = escapeHtml(parsed.title);
  const references = parsed.references
    .map((reference) => `<li>${escapeHtml(reference)}</li>`)
    .join("");

  const payload = JSON.stringify({ role, title: parsed.title }, null, 2);

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} - Interactive</title>
  <style>
    :root {
      --bg: #f5f7fb;
      --surface: #ffffff;
      --surface-soft: #f8fafc;
      --line: #d9e1ec;
      --line-strong: #b9c6d8;
      --text: #17212f;
      --muted: #5c6b80;
      --accent: #1354c5;
      --accent-soft: #e8f0ff;
      --danger: #b42318;
      --pass: #127c4f;
      --na: #7a5b00;
      --font: "TH Sarabun New", "Sarabun", "Noto Sans Thai", "Segoe UI", sans-serif;
    }
    @page { size: A4; margin: 6mm; }
    html, body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      font-size: 16px;
      line-height: 1.35;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body { padding: 20px; }
    .sheet {
      max-width: 1180px;
      margin: 0 auto;
      background: var(--surface);
      border: 1px solid var(--line);
      box-shadow: 0 12px 36px rgba(13, 32, 62, 0.08);
      border-radius: 16px;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 14px 18px;
      background: #eef4ff;
      border-bottom: 1px solid var(--line);
      position: sticky;
      top: 0;
      z-index: 5;
    }
    .toolbar-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .toolbar-title strong {
      font-size: 20px;
      line-height: 1.1;
    }
    .toolbar-title span {
      color: var(--muted);
      font-size: 13px;
    }
    .toolbar-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .session-controls {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 10px;
      padding: 6px;
    }
    .session-controls label {
      font-size: 13px;
      color: var(--muted);
      font-weight: 600;
    }
    .session-controls select,
    .session-controls input {
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      padding: 6px 8px;
      font: inherit;
      min-height: 34px;
      box-sizing: border-box;
    }
    .session-controls select {
      min-width: 150px;
      background: #fff;
    }
    .session-controls input {
      width: 180px;
    }
    .save-state {
      font-size: 13px;
      color: var(--muted);
      min-width: 110px;
      text-align: right;
    }
    button {
      appearance: none;
      border: 1px solid var(--line-strong);
      background: #fff;
      color: var(--text);
      border-radius: 10px;
      padding: 8px 12px;
      cursor: pointer;
      font: inherit;
    }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    button.danger {
      color: var(--danger);
    }
    .content {
      padding: 18px 18px 24px;
    }
    .header-card, .section-card {
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--surface);
      padding: 16px;
    }
    .header-card {
      margin-bottom: 16px;
      background: linear-gradient(180deg, #ffffff 0%, #f9fbff 100%);
    }
    h1, h2, h3, p { margin: 0; }
    h1 {
      font-size: 30px;
      line-height: 1.06;
      margin-bottom: 6px;
    }
    .references {
      margin-top: 12px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 0;
      list-style: none;
    }
    .references li {
      border: 1px solid var(--line);
      background: var(--surface-soft);
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 13px;
      color: var(--muted);
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 16px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .field label {
      font-size: 14px;
      color: var(--muted);
      font-weight: 600;
    }
    input[type="text"], textarea {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--line-strong);
      border-radius: 10px;
      padding: 8px 10px;
      background: #fff;
      color: var(--text);
      font: inherit;
    }
    textarea {
      resize: vertical;
      min-height: 72px;
    }
    .sections {
      display: grid;
      gap: 16px;
    }
    .section-card h2 {
      font-size: 22px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 8px;
    }
    .item-grid {
      display: grid;
      gap: 10px;
    }
    .check-item {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
      background: var(--surface-soft);
      display: grid;
      gap: 10px;
    }
    .item-text {
      font-weight: 600;
    }
    .item-controls {
      display: grid;
      grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }
    .status-group {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .status-pill {
      position: relative;
    }
    .status-pill input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .status-pill span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 84px;
      border: 1px solid var(--line-strong);
      border-radius: 999px;
      padding: 7px 12px;
      background: #fff;
      color: var(--muted);
      font-size: 14px;
      cursor: pointer;
    }
    .status-pill input:checked + span {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 700;
    }
    .status-pill.pass input:checked + span {
      border-color: var(--pass);
      background: #eaf7f1;
      color: var(--pass);
    }
    .status-pill.fail input:checked + span {
      border-color: var(--danger);
      background: #fdeceb;
      color: var(--danger);
    }
    .status-pill.na input:checked + span {
      border-color: var(--na);
      background: #fff7d6;
      color: var(--na);
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      border: 1px solid var(--line);
      padding: 8px;
      vertical-align: top;
      text-align: left;
    }
    th {
      background: #eef4ff;
      font-size: 14px;
    }
    td input[type="text"], td textarea {
      min-height: 0;
      border-radius: 8px;
      padding: 6px 8px;
    }
    .decision-grid {
      display: grid;
      gap: 16px;
    }
    .decision-box {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
      background: var(--surface-soft);
    }
    .notes-list {
      display: grid;
      gap: 8px;
      color: var(--muted);
    }
    @media print {
      html, body {
        background: #fff;
        font-size: 10px;
      }
      body {
        padding: 0;
      }
      .sheet {
        max-width: none;
        border: none;
        box-shadow: none;
        border-radius: 0;
      }
      .toolbar {
        display: none;
      }
      .content {
        padding: 0;
      }
      .header-card, .section-card, .check-item, .decision-box {
        border-radius: 0;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .sections {
        gap: 8px;
      }
      .section-card {
        padding: 8px 10px;
      }
      .check-item {
        padding: 8px;
        gap: 6px;
      }
      .item-controls {
        grid-template-columns: 180px 1fr;
        gap: 8px;
      }
      .status-pill span {
        min-width: 54px;
        padding: 3px 6px;
        font-size: 10px;
      }
      input[type="text"], textarea {
        border: 1px solid #9aa7b8;
        padding: 4px 6px;
        font-size: 10px;
      }
      textarea {
        min-height: 42px;
      }
    }
    @media (max-width: 960px) {
      body {
        padding: 12px;
      }
      .meta-grid, .item-controls {
        grid-template-columns: 1fr;
      }
      .toolbar {
        align-items: flex-start;
        flex-direction: column;
      }
      .toolbar-actions {
        width: 100%;
      }
      .save-state {
        text-align: left;
      }
    }
  </style>
</head>
<body>
  <div class="sheet" data-role="${escapeHtml(role)}">
    <div class="toolbar">
      <div class="toolbar-title">
        <strong>${title}</strong>
        <span>interactive form + localStorage เฉพาะเครื่องนี้</span>
      </div>
      <div class="toolbar-actions">
        <div class="session-controls">
          <label for="session-select">ชุดบันทึก</label>
          <select id="session-select" data-session-select></select>
          <input type="text" placeholder="ชื่อชุดใหม่" data-session-input />
          <button type="button" data-session-create>สร้างชุด</button>
          <button type="button" class="danger" data-session-delete>ลบชุด</button>
        </div>
        <div class="save-state" data-save-state>ยังไม่บันทึก</div>
        <button type="button" class="primary" data-print-button>พิมพ์</button>
        <button type="button" class="danger" data-reset-button>ล้างฟอร์ม role นี้</button>
      </div>
    </div>
    <div class="content">
      <section class="header-card">
        <h1>${title}</h1>
        <p>กรอกจากกระดาษที่ทีมส่งกลับ แล้วระบบจะจำค่าไว้ใน browser เครื่องนี้อัตโนมัติ</p>
        <ul class="references">${references}</ul>
      </section>
      ${body}
    </div>
  </div>
  <script>
    window.__UAT_FORM_CONFIG__ = ${payload};
  </script>
  <script src="./${runtimeFileName}"></script>
</body>
</html>
`;
}

function renderSection(role, section, sectionIndex) {
  if (section.type === "metadata") {
    const fields = section.fields
      .map((field, fieldIndex) => {
        const key = `${role}:meta:${fieldIndex}`;
        return `<div class="field">
  <label for="${escapeHtml(key)}">${escapeHtml(field.label)}</label>
  <input type="text" id="${escapeHtml(key)}" data-storage-key="${escapeHtml(
          key,
        )}" value="${escapeHtml(field.defaultValue)}" />
</div>`;
      })
      .join("\n");
    return `<section class="section-card"><h2>${escapeHtml(
      section.title,
    )}</h2><div class="meta-grid">${fields}</div></section>`;
  }

  if (section.type === "table") {
    const header = section.table.header
      .map((cell) => `<th>${escapeHtml(cell)}</th>`)
      .join("");
    const rows = section.table.rows
      .map((row, rowIndex) => {
        const cells = row
          .map((cell, cellIndex) => {
            const key = `${role}:table:${sectionIndex}:${rowIndex}:${cellIndex}`;
            const smallText = cell.length <= 4;
            return `<td>${
              smallText
                ? `<input type="text" data-storage-key="${escapeHtml(key)}" value="${escapeHtml(cell)}" />`
                : `<textarea data-storage-key="${escapeHtml(key)}">${escapeHtml(cell)}</textarea>`
            }</td>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
    return `<section class="section-card">
  <h2>${escapeHtml(section.title)}</h2>
  <div class="table-wrap">
    <table>
      <thead><tr>${header}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</section>`;
  }

  if (section.type === "decision") {
    const items = renderChecklistItems(role, section.items, `${sectionIndex}`);
    const decisionKey = `${role}:decision:${sectionIndex}`;
    const approverKey = `${role}:approver:${sectionIndex}`;
    return `<section class="section-card">
  <h2>${escapeHtml(section.title)}</h2>
  <div class="decision-grid">
    <div class="item-grid">${items}</div>
    <div class="decision-box">
      <div class="field">
        <label>${escapeHtml(section.decisionLabel)}</label>
        <div class="status-group">
          ${renderDecisionPill(decisionKey, "PASS", "pass")}
          ${renderDecisionPill(decisionKey, "FAIL", "fail")}
        </div>
      </div>
      <div class="field" style="margin-top: 12px;">
        <label for="${escapeHtml(approverKey)}">${escapeHtml(section.approverLabel)}</label>
        <input type="text" id="${escapeHtml(
          approverKey,
        )}" data-storage-key="${escapeHtml(approverKey)}" />
      </div>
    </div>
  </div>
</section>`;
  }

  if (section.type === "notes") {
    const lines = section.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
    return `<section class="section-card"><h2>${escapeHtml(
      section.title,
    )}</h2><div class="notes-list">${lines}</div></section>`;
  }

  return `<section class="section-card"><h2>${escapeHtml(
    section.title,
  )}</h2><div class="item-grid">${renderChecklistItems(
    role,
    section.items,
    `${sectionIndex}`,
  )}</div></section>`;
}

function renderChecklistItems(role, items, sectionKey) {
  return items
    .map((item, itemIndex) => {
      const groupKey = `${role}:item:${sectionKey}:${itemIndex}:status`;
      const noteKey = `${role}:item:${sectionKey}:${itemIndex}:note`;
      return `<article class="check-item">
  <div class="item-text">${escapeHtml(item)}</div>
  <div class="item-controls">
    <div class="status-group">
      ${renderStatusPill(groupKey, "pass", "ผ่าน")}
      ${renderStatusPill(groupKey, "fail", "ไม่ผ่าน")}
      ${renderStatusPill(groupKey, "na", "ไม่ทดสอบ")}
    </div>
    <div class="field">
      <label for="${escapeHtml(noteKey)}">หมายเหตุ</label>
      <textarea id="${escapeHtml(noteKey)}" data-storage-key="${escapeHtml(noteKey)}"></textarea>
    </div>
  </div>
</article>`;
    })
    .join("");
}

function renderStatusPill(groupKey, value, label) {
  const inputId = `${groupKey}:${value}`;
  return `<label class="status-pill ${escapeHtml(value)}" for="${escapeHtml(inputId)}">
  <input type="radio" id="${escapeHtml(inputId)}" name="${escapeHtml(
    groupKey,
  )}" value="${escapeHtml(value)}" data-storage-key="${escapeHtml(groupKey)}" />
  <span>${escapeHtml(label)}</span>
</label>`;
}

function renderDecisionPill(groupKey, value, kind) {
  const inputId = `${groupKey}:${value.toLowerCase()}`;
  return `<label class="status-pill ${escapeHtml(kind)}" for="${escapeHtml(inputId)}">
  <input type="radio" id="${escapeHtml(inputId)}" name="${escapeHtml(
    groupKey,
  )}" value="${escapeHtml(value)}" data-storage-key="${escapeHtml(groupKey)}" />
  <span>${escapeHtml(value)}</span>
</label>`;
}

const runtimeSource = `(() => {
  const config = window.__UAT_FORM_CONFIG__;
  if (!config || !config.role) {
    return;
  }

  const profileRegistryKey = \`uat-interactive:\${config.role}:profiles\`;
  const legacyStorageKey = \`uat-interactive:\${config.role}\`;
  const defaultProfile = "default";
  const saveState = document.querySelector("[data-save-state]");
  const printButton = document.querySelector("[data-print-button]");
  const resetButton = document.querySelector("[data-reset-button]");
  const sessionSelect = document.querySelector("[data-session-select]");
  const sessionInput = document.querySelector("[data-session-input]");
  const sessionCreateButton = document.querySelector("[data-session-create]");
  const sessionDeleteButton = document.querySelector("[data-session-delete]");
  const inputs = Array.from(document.querySelectorAll("[data-storage-key]"));
  let activeProfile = defaultProfile;

  function profileStorageKey(profileName) {
    return \`uat-interactive:\${config.role}:profile:\${profileName}\`;
  }

  function normalizeProfileName(raw) {
    const value = String(raw || "").trim().replace(/\\s+/g, "-").toLowerCase();
    return value || "";
  }

  function readProfiles() {
    try {
      const raw = window.localStorage.getItem(profileRegistryKey);
      if (!raw) {
        return [defaultProfile];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [defaultProfile];
      }
      const normalized = parsed
        .map((item) => normalizeProfileName(item))
        .filter((item) => item.length > 0);
      if (!normalized.includes(defaultProfile)) {
        normalized.unshift(defaultProfile);
      }
      return Array.from(new Set(normalized));
    } catch {
      return [defaultProfile];
    }
  }

  function writeProfiles(nextProfiles) {
    window.localStorage.setItem(profileRegistryKey, JSON.stringify(nextProfiles));
  }

  function ensureLegacyMigration() {
    const legacy = window.localStorage.getItem(legacyStorageKey);
    if (!legacy) {
      return;
    }
    const currentDefault = window.localStorage.getItem(profileStorageKey(defaultProfile));
    if (!currentDefault) {
      window.localStorage.setItem(profileStorageKey(defaultProfile), legacy);
    }
    window.localStorage.removeItem(legacyStorageKey);
  }

  function renderProfileOptions(nextProfiles) {
    if (!sessionSelect) {
      return;
    }
    const current = sessionSelect.value || activeProfile;
    sessionSelect.innerHTML = "";
    for (const profile of nextProfiles) {
      const option = document.createElement("option");
      option.value = profile;
      option.textContent = profile;
      sessionSelect.appendChild(option);
    }
    sessionSelect.value = nextProfiles.includes(current) ? current : defaultProfile;
    activeProfile = sessionSelect.value;
  }

  function readState() {
    try {
      const raw = window.localStorage.getItem(profileStorageKey(activeProfile));
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function writeState(nextState, message) {
    window.localStorage.setItem(profileStorageKey(activeProfile), JSON.stringify(nextState));
    if (saveState) {
      const timestamp = new Date().toLocaleString("th-TH", {
        dateStyle: "short",
        timeStyle: "short",
      });
      const profileLabel = \`[\${activeProfile}]\`;
      saveState.textContent = message
        ? \`\${profileLabel} \${message} • \${timestamp}\`
        : \`\${profileLabel} บันทึกอัตโนมัติ • \${timestamp}\`;
    }
  }

  function applyState(state) {
    for (const input of inputs) {
      const key = input.dataset.storageKey;
      const value = Object.prototype.hasOwnProperty.call(state, key) ? state[key] : null;
      if (input.type === "radio") {
        input.checked = value === input.value;
      } else if (value !== null) {
        input.value = value;
      }
    }
    if (saveState && !window.localStorage.getItem(profileStorageKey(activeProfile))) {
      saveState.textContent = \`[\${activeProfile}] ยังไม่มีข้อมูลที่บันทึก\`;
    }
  }

  function collectState() {
    const nextState = {};
    for (const input of inputs) {
      const key = input.dataset.storageKey;
      if (!key) {
        continue;
      }
      if (input.type === "radio") {
        if (input.checked) {
          nextState[key] = input.value;
        }
        continue;
      }
      if (input.value && input.value.length > 0) {
        nextState[key] = input.value;
      }
    }
    return nextState;
  }

  function saveNow(message) {
    writeState(collectState(), message);
  }

  for (const input of inputs) {
    const eventName = input.type === "radio" ? "change" : "input";
    input.addEventListener(eventName, () => saveNow(""));
  }

  if (printButton) {
    printButton.addEventListener("click", () => window.print());
  }

  if (resetButton) {
    resetButton.addEventListener("click", () => {
      const shouldReset = window.confirm(\`ล้างข้อมูล checklist ของชุด [\${activeProfile}] ใน role นี้ใช่หรือไม่\`);
      if (!shouldReset) {
        return;
      }
      window.localStorage.removeItem(profileStorageKey(activeProfile));
      for (const input of inputs) {
        if (input.type === "radio") {
          input.checked = false;
        } else {
          input.value = "";
        }
      }
      if (saveState) {
        saveState.textContent = \`[\${activeProfile}] ล้างข้อมูลแล้ว\`;
      }
    });
  }

  function switchProfile(profileName) {
    activeProfile = profileName;
    applyState(readState());
  }

  if (sessionSelect) {
    sessionSelect.addEventListener("change", () => {
      switchProfile(sessionSelect.value || defaultProfile);
    });
  }

  if (sessionCreateButton) {
    sessionCreateButton.addEventListener("click", () => {
      const rawName = sessionInput ? sessionInput.value : "";
      const profileName = normalizeProfileName(rawName);
      if (!profileName) {
        window.alert("กรุณาตั้งชื่อชุดใหม่");
        return;
      }
      const profiles = readProfiles();
      if (profiles.includes(profileName)) {
        window.alert("ชื่อชุดนี้มีอยู่แล้ว");
        return;
      }
      const nextProfiles = [...profiles, profileName];
      writeProfiles(nextProfiles);
      renderProfileOptions(nextProfiles);
      if (sessionInput) {
        sessionInput.value = "";
      }
      switchProfile(profileName);
    });
  }

  if (sessionDeleteButton) {
    sessionDeleteButton.addEventListener("click", () => {
      if (activeProfile === defaultProfile) {
        window.alert("ลบชุด default ไม่ได้");
        return;
      }
      const shouldDelete = window.confirm(\`ลบชุด [\${activeProfile}] ใช่หรือไม่\`);
      if (!shouldDelete) {
        return;
      }
      window.localStorage.removeItem(profileStorageKey(activeProfile));
      const profiles = readProfiles().filter((item) => item !== activeProfile);
      writeProfiles(profiles);
      renderProfileOptions(profiles);
      switchProfile(sessionSelect ? sessionSelect.value : defaultProfile);
    });
  }

  ensureLegacyMigration();
  const profiles = readProfiles();
  writeProfiles(profiles);
  renderProfileOptions(profiles);
  switchProfile(activeProfile);
})();`;

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, runtimeFileName), runtimeSource, "utf8");

  for (const [role, fileName] of roleFiles) {
    const markdown = await fs.readFile(path.join(docsDir, fileName), "utf8");
    const parsed = parseChecklistMarkdown(markdown);
    const html = buildPageHtml(role, parsed);
    await fs.writeFile(path.join(outputDir, `${role}.html`), html, "utf8");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
