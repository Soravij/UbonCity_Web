/**
 * trigger-field-pack.js
 *
 * เรียก generateFieldPack() โดยตรงสำหรับ item ที่กำหนด
 * ใช้ agent-engine จาก agent-generation.mjs + ai config + repository
 *
 * การใช้งาน:
 *   node scripts/trigger-field-pack.js --id 113
 */

import path from "path";
import fs from "fs";
import { resolvePaths } from "../config/paths.mjs";
import { resolveAiConfig } from "../config/ai.mjs";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { FIELD_PACK_AGENT_KEY, createAgentGenerationEngine } from "../services/agent-generation.mjs";

// ── parse args ──────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let itemId = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--id" && args[i + 1]) {
      itemId = Number(args[i + 1]) || 0;
      i++;
    }
  }
  return { itemId };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const { itemId } = parseArgs();

  if (!itemId) {
    console.error("Usage: node scripts/trigger-field-pack.js --id <itemId>");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log(`[trigger-field-pack] Starting for item #${itemId}`);
  console.log("=".repeat(60));

  // 1. resolve paths, ai config, database, repository
  console.log("\n[1/5] Initializing dependencies...");
  const dirs = resolvePaths(path.resolve(process.cwd()));
  console.log(`   dbPath: ${dirs.dbPath}`);
  console.log(`   mediaDir: ${dirs.mediaDir}`);

  const aiConfig = resolveAiConfig();
  console.log(`   ai provider: ${aiConfig.provider}`);
  console.log(`   ai model:    ${aiConfig.model}`);
  console.log(`   ai enabled:  ${aiConfig.enabled}`);
  console.log(`   agentEngine: ${aiConfig.agentEngine}`);
  if (aiConfig.agentEngine === "internal" && !aiConfig.enabled) {
    console.error("   ERROR: backend AI proxy is not ready (check COLLECTOR_SYNC_BACKEND_API and LIFECYCLE_SYNC_TOKEN)");
    process.exit(1);
  }

  const db = openDatabase(dirs.dbPath);
  if (!db) {
    console.error("   ERROR: cannot open database");
    process.exit(1);
  }
  const repo = createRepository(db);
  console.log("   database OK");

  // 2. load item
  console.log(`\n[2/5] Loading item #${itemId}...`);
  const item = repo.getItem(itemId);
  if (!item) {
    console.error(`   ERROR: item #${itemId} not found`);
    process.exit(1);
  }
  console.log(`   title:       ${String(item.title || "").trim() || "(no title)"}`);
  console.log(`   type:        ${String(item.type || "").trim() || "-"}`);
  console.log(`   category:    ${String(item.category || "").trim() || "-"}`);
  console.log(`   status:      ${String(item.workflow_status || item.production_state || "").trim() || "-"}`);

  // 3. load structured_context (approved_context + evidence_blocks + image_context)
  console.log(`\n[3/5] Loading structured context...`);
  const context = repo.getCleanStructuredContext(itemId);
  if (context) {
    const approvedCount = Array.isArray(context.approved_context) ? context.approved_context.length : 0;
    const evidenceCount = Array.isArray(context.evidence_blocks) ? context.evidence_blocks.length : 0;
    console.log(`   approved_context:  ${approvedCount} blocks`);
    console.log(`   evidence_blocks:   ${evidenceCount} blocks`);
    console.log(`   context_version:   ${String(context.context_version || "").trim() || "-"}`);
  } else {
    console.log(`   WARNING: no structured context found for item #${itemId}`);
  }

  // 4. load field pack agent profile from DB
  console.log(`\n[4/5] Loading agent profile...`);
  const fieldPackAgentProfile = repo.getAgentProfile
    ? repo.getAgentProfile(FIELD_PACK_AGENT_KEY)
    : null;

  if (fieldPackAgentProfile) {
    console.log(`   agent_key:     ${fieldPackAgentProfile.agent_key}`);
    console.log(`   display_name:  ${fieldPackAgentProfile.display_name}`);
    console.log(`   is_enabled:    ${fieldPackAgentProfile.is_enabled}`);
    console.log(`   profile_text:  ${(fieldPackAgentProfile.profile_text || "").substring(0, 120)}...`);
  } else {
    console.log(`   WARNING: no agent profile in DB for key="${FIELD_PACK_AGENT_KEY}", using default`);
  }

  // 5. check if visual_image_urls should be populated from image_context
  const imageContext = context?.image_context || {};
  const visualImageUrls = [];
  if (imageContext.cover_url) visualImageUrls.push(imageContext.cover_url);
  if (Array.isArray(imageContext.gallery_urls)) {
    for (const url of imageContext.gallery_urls) {
      if (url && !visualImageUrls.includes(url)) visualImageUrls.push(url);
    }
  }
  if (Array.isArray(imageContext.inline_urls)) {
    for (const url of imageContext.inline_urls) {
      if (url && !visualImageUrls.includes(url)) visualImageUrls.push(url);
    }
  }
  // limit to 5
  item.visual_image_urls = visualImageUrls.slice(0, 5);
  item.structured_context = context;

  console.log(`   visual_image_urls: ${item.visual_image_urls.length} images`);
  for (const url of item.visual_image_urls) {
    console.log(`     - ${url.substring(0, 100)}`);
  }

  // 6. create agent engine and generate field pack
  console.log(`\n[5/5] Generating field pack via ${aiConfig.agentEngine} engine...`);
  const agentEngine = createAgentGenerationEngine(aiConfig);

  try {
    // create agentInput ตาม pattern เดียวกับ server/index.mjs
    const agentInput = {
      ...item,
      agent_profile: fieldPackAgentProfile,
      visual_context: null, // no pre-generated visual context
    };

    console.log("\n--- Calling agentEngine.generateFieldPack() ---");
    console.time("generateFieldPack");

    const fieldPack = await agentEngine.generateFieldPack(agentInput);

    console.timeEnd("generateFieldPack");
    console.log("--- Done ---\n");

    // 7. save response to file
    const outputDir = path.resolve("./tmp");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputFile = path.join(outputDir, `field-pack-item-${itemId}-${timestamp}.json`);

    const outputPayload = {
      item_id: itemId,
      generated_at: new Date().toISOString(),
      ai_config: {
        provider: aiConfig.provider,
        model: aiConfig.model,
        agentEngine: aiConfig.agentEngine,
      },
      agent_profile_used: fieldPackAgentProfile
        ? {
            agent_key: fieldPackAgentProfile.agent_key,
            display_name: fieldPackAgentProfile.display_name,
            profile_text_preview: (fieldPackAgentProfile.profile_text || "").substring(0, 200) + "...",
          }
        : "default (DEFAULT_FIELD_PACK_AGENT_PROFILE)",
      visual_image_count: item.visual_image_urls.length,
      field_pack: fieldPack,
    };

    fs.writeFileSync(outputFile, JSON.stringify(outputPayload, null, 2), "utf-8");
    console.log(`\n✓ Response saved to: ${outputFile}`);
    console.log(`  File size: ${fs.statSync(outputFile).size} bytes`);

    // 8. print summary
    console.log("\n" + "─".repeat(60));
    console.log("FIELD PACK SUMMARY");
    console.log("─".repeat(60));
    console.log(`  status:         ${fieldPack.status}`);
    console.log(`  ai_summary:     ${(fieldPack.ai_summary || "").substring(0, 200)}`);
    console.log(`  ai_highlights:  ${Array.isArray(fieldPack.ai_highlights) ? fieldPack.ai_highlights.length : 0} items`);
    console.log(`  ai_unknowns:    ${Array.isArray(fieldPack.ai_unknowns) ? fieldPack.ai_unknowns.length : 0} items`);
    console.log(`  story_angle:    ${(fieldPack.story_angle || "").substring(0, 150)}`);
    console.log(`  field_notes:    ${(fieldPack.field_notes || "").substring(0, 150)}`);
    console.log(`  social_hook:    ${(fieldPack.social_hook || "").substring(0, 150)}`);
    console.log(`  checklists:`);
    console.log(`    must_verify_fact:   ${fieldPack.field_pack_checklists.filter(c => c.checklist_type === "must_verify_fact").length} items`);
    console.log(`    must_capture_shot:  ${fieldPack.field_pack_checklists.filter(c => c.checklist_type === "must_capture_shot").length} items`);
    console.log(`    must_ask_question:  ${fieldPack.field_pack_checklists.filter(c => c.checklist_type === "must_ask_question").length} items`);

    console.log("\n✓ Done!");
  } catch (error) {
    console.error("\n✗ ERROR during field pack generation:");
    console.error(`  ${error.message}`);
    if (error.cause) {
      console.error(`  cause: ${error.cause.message || error.cause}`);
    }
    console.error(`  stack: ${error.stack ? error.stack.split("\n").slice(0, 5).join("\n    ") : "(no stack)"}`);

    // save error to file
    const outputDir = path.resolve("./tmp");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const errorFile = path.join(outputDir, `field-pack-error-item-${itemId}-${timestamp}.json`);
    fs.writeFileSync(errorFile, JSON.stringify({
      item_id: itemId,
      error_at: new Date().toISOString(),
      error: error.message,
      cause: error.cause ? String(error.cause) : null,
      stack: error.stack,
    }, null, 2), "utf-8");
    console.log(`\n  Error details saved to: ${errorFile}`);

    process.exit(1);
  } finally {
    if (db && typeof db.close === "function") {
      db.close();
    }
  }
}

main();
