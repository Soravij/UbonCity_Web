import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dirs = resolvePaths(rootDir);
const schemaPath = path.join(dirs.rootDir, "database", "schema.sql");
const db = openDatabase(dirs.dbPath, schemaPath);
const repo = createRepository(db);

const SEED_MARKER = "mock-work-stage-20260404";
const SEED_ACTOR_EMAIL = "seed.mock.work.stage@uboncity.local";
const VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const VIDEO_TITLE = "ตัวอย่างวิดีโอประกอบงาน (remote sample)";
const REQUIRED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const LOCAL_MEDIA_BASE_URL = String(process.env.COLLECTOR_MEDIA_BASE_URL || "http://127.0.0.1:5070").replace(/\/+$/, "");
const TARGET_EMAIL = "user@uboncity.com";
const MOCK_USER_EMAILS = [
  "mock-freelance-a@uboncity.local",
  "mock-freelance-b@uboncity.local",
  "mock-user.work@uboncity.local",
  "mock-admin.work@uboncity.local",
];

const JOBS = [
  {
    key: "riverside-market",
    title: "ตลาดเช้าริมมูลอุบลราชธานี",
    category: "market",
    slug: "mock-riverside-market-ubon-20260404",
    latitude: 15.2416,
    longitude: 104.8488,
    map_url: "https://maps.google.com/?q=15.2416,104.8488",
    google_place_id: "mock-place-20260404-01",
    tags: ["ตลาดเช้า", "ริมแม่น้ำมูล", "ของกินท้องถิ่น"],
    summary: "ลงพื้นที่เก็บข้อมูลบรรยากาศตลาดเช้าริมแม่น้ำมูล เน้นภาพรวมร้านดัง จุดขาย และเสียงจากแม่ค้าในพื้นที่",
    description_raw: "โจทย์งานลงพื้นที่ตลาดเช้าริมแม่น้ำมูล เก็บข้อมูลบรรยากาศช่วง 06:00-08:00 น. พร้อมรูปและวิดีโอประกอบ",
    description_clean: "เก็บข้อมูลตลาดเช้าริมแม่น้ำมูลพร้อมภาพประกอบ จุดขาย เมนูเด่น และบริบทการเดินทาง",
    meta_title: "Mock งานลงพื้นที่ตลาดเช้าริมมูล อุบลราชธานี",
    meta_description: "ข้อมูลทดสอบงานลงพื้นที่ตลาดเช้าริมมูล พร้อมรูป วิดีโอ และคำตอบภาคสนามครบถ้วน",
    story_angle: "ตลาดเช้าริมน้ำที่ยังรักษาเสน่ห์ชุมชนและของกินพื้นถิ่น",
    social_hook: "ถ้ามาอุบลตอนเช้า อย่าพลาดเดินตลาดริมน้ำมูล",
    verified_facts: ["ตลาดเปิดจริงช่วงเช้าก่อน 09:00 น.", "มีโซนอาหารพร้อมทานและโซนวัตถุดิบสด"],
    questions: ["เมนูที่คนซื้อซ้ำมากที่สุดคืออะไร", "ช่วงเวลาที่คนแน่นที่สุดอยู่ประมาณกี่โมง"],
    captures: ["ภาพกว้างบรรยากาศตลาดติดแม่น้ำ", "ภาพ close-up ร้านอาหารเช้าขายดี", "คลิปเดินผ่านทางเดินหลักของตลาด"],
    additional_text: "เจอประเด็นว่านักท่องเที่ยวชอบตลาดเพราะได้เห็นวิถีคนเมืองอุบลช่วงเช้าจริง ๆ",
    review_note: "ภาพรอบแรกยังไม่เห็นป้ายตลาดชัด ขอเพิ่มมุมป้ายทางเข้าและคลิป ambience ยาวขึ้น",
  },
  {
    key: "bamboo-garden-cafe",
    title: "คาเฟ่สวนไผ่โซนชานเมืองอุบล",
    category: "cafe",
    slug: "mock-bamboo-garden-cafe-20260404",
    latitude: 15.2865,
    longitude: 104.8202,
    map_url: "https://maps.google.com/?q=15.2865,104.8202",
    google_place_id: "mock-place-20260404-02",
    tags: ["คาเฟ่", "สวนไผ่", "ชานเมืองอุบล"],
    summary: "เก็บมุมร้านคาเฟ่สวนไผ่ เน้นทางเข้าร้าน มุมถ่ายรูป และเมนูขายดี พร้อมถามเรื่องช่วงเวลาคนน้อย",
    description_raw: "ลงพื้นที่คาเฟ่สวนไผ่ ถ่ายรูปหน้าร้าน เครื่องดื่มซิกเนเจอร์ และบรรยากาศมุมสวน",
    description_clean: "งานภาคสนามสำหรับคาเฟ่สวนไผ่ ครบทั้งภาพร้าน เมนูเด่น และข้อมูลการเดินทาง",
    meta_title: "Mock งานลงพื้นที่คาเฟ่สวนไผ่ อุบล",
    meta_description: "ข้อมูลทดสอบการลงพื้นที่คาเฟ่สวนไผ่ พร้อมสื่อประกอบและคำตอบหน้างานครบ",
    story_angle: "คาเฟ่บรรยากาศสวนที่เน้นพื้นที่พักผ่อนและมุมถ่ายรูป",
    social_hook: "คาเฟ่นี้เด่นตรงวิวสวนไผ่และแสงช่วงบ่าย",
    verified_facts: ["ร้านมีทั้งโซน indoor และ garden", "เครื่องดื่มซิกเนเจอร์มีเมนูผลไม้ท้องถิ่น"],
    questions: ["มุมที่ลูกค้านิยมถ่ายรูปมากที่สุดอยู่ตรงไหน", "ร้านแนะนำให้มาช่วงเวลาใดเพื่อได้แสงสวย"],
    captures: ["ภาพป้ายหน้าร้านและทางเข้า", "ภาพมุมสวนพร้อมโต๊ะนั่ง", "คลิปแพนบรรยากาศสวน"],
    additional_text: "เจ้าของร้านบอกว่าช่วง 15:30-17:00 เป็นเวลาที่คนถ่ายรูปมากที่สุด",
    review_note: "ข้อมูลครบแล้ว แต่ขอรูปแก้วเมนูซิกเนเจอร์บนโต๊ะไม้เพิ่มอีก 1 มุม",
  },
  {
    key: "wat-nong-bua-evening",
    title: "บรรยากาศวัดหนองบัวยามเย็น",
    category: "temple",
    slug: "mock-wat-nong-bua-evening-20260404",
    latitude: 15.2524,
    longitude: 104.8772,
    map_url: "https://maps.google.com/?q=15.2524,104.8772",
    google_place_id: "mock-place-20260404-03",
    tags: ["วัดหนองบัว", "วัด", "เที่ยวอุบล"],
    summary: "ลงพื้นที่เก็บภาพวัดหนองบัวยามเย็น เน้นองค์เจดีย์ มุมถ่ายรูป และคำอธิบายจุดเด่นสำหรับนักท่องเที่ยว",
    description_raw: "ถ่ายภาพเจดีย์ มุมโดยรอบ และคลิป ambience ยามเย็นที่วัดหนองบัว",
    description_clean: "งานลงพื้นที่วัดหนองบัวพร้อมข้อมูลมุมเด่นและบรรยากาศช่วงเย็น",
    meta_title: "Mock งานลงพื้นที่วัดหนองบัวยามเย็น",
    meta_description: "ข้อมูลทดสอบงานลงพื้นที่วัดหนองบัว พร้อมภาพ วิดีโอ และคำตอบภาคสนาม",
    story_angle: "แลนด์มาร์กเชิงวัฒนธรรมที่ถ่ายภาพสวยช่วงแดดอ่อนก่อนค่ำ",
    social_hook: "ถ้าจะถ่ายวัดหนองบัวให้สวย ลองไปช่วงแดดเย็นก่อนพระอาทิตย์ตก",
    verified_facts: ["จุดเด่นหลักคือเจดีย์ทรงคล้ายมหาโพธิเจดีย์", "พื้นที่โดยรอบเดินชมได้สะดวก"],
    questions: ["ช่วงเวลาไหนแสงตกกระทบองค์เจดีย์สวยที่สุด", "นักท่องเที่ยวนิยมถ่ายรูปจากมุมใดมากที่สุด"],
    captures: ["ภาพเต็มองค์เจดีย์ด้านหน้า", "ภาพมุมด้านข้างเห็นลานกว้าง", "คลิป ambience ช่วงเย็น"],
    additional_text: "แนะนำใช้มุมกึ่งเฉียงเพื่อให้เห็นความลึกของลานและองค์เจดีย์พร้อมกัน",
    review_note: "ต้องการภาพมุมคนเดินในเฟรมเพื่อให้เห็นสเกลพื้นที่เพิ่ม",
  },
  {
    key: "moon-river-bike-lane",
    title: "เส้นทางจักรยานริมน้ำมูลฝั่งเมือง",
    category: "activity",
    slug: "mock-moon-river-bike-lane-20260404",
    latitude: 15.2385,
    longitude: 104.8526,
    map_url: "https://maps.google.com/?q=15.2385,104.8526",
    google_place_id: "mock-place-20260404-04",
    tags: ["จักรยาน", "ริมน้ำมูล", "กิจกรรมกลางแจ้ง"],
    summary: "สำรวจเส้นทางจักรยานริมน้ำมูล เน้นสภาพเส้นทาง จุดพัก และช่วงเวลาที่ใช้งานจริง",
    description_raw: "งานลงพื้นที่เส้นทางจักรยานริมน้ำมูล เก็บภาพทางปั่น จุดนั่งพัก และคลิปบรรยากาศ",
    description_clean: "ข้อมูลภาคสนามเส้นทางจักรยานริมน้ำมูล สำหรับใช้ทำคอนเทนต์แนะนำกิจกรรม",
    meta_title: "Mock งานลงพื้นที่เส้นทางจักรยานริมน้ำมูล",
    meta_description: "ข้อมูลทดสอบเส้นทางจักรยานริมน้ำมูลพร้อมสื่อประกอบครบ",
    story_angle: "กิจกรรมเบา ๆ ริมแม่น้ำที่เหมาะทั้งคนท้องถิ่นและนักท่องเที่ยว",
    social_hook: "เย็น ๆ อยากปั่นรับลม เส้นนี้ตอบโจทย์ทั้งวิวและความต่อเนื่องของทาง",
    verified_facts: ["ทางปั่นมีช่วงที่อยู่ติดแม่น้ำจริง", "มีจุดพักและม้านั่งตลอดบางช่วง"],
    questions: ["จุดไหนวิวดีที่สุดสำหรับคนปั่นมาช่วงเย็น", "มีช่วงไหนของเส้นทางที่ต้องระวังพื้นผิวหรือการสัญจร"],
    captures: ["ภาพกว้างทางปั่นติดแม่น้ำ", "ภาพจุดพักและม้านั่ง", "คลิปขณะเคลื่อนผ่านเส้นทาง"],
    additional_text: "ควรเน้นว่าเส้นทางเหมาะกับช่วงแดดร่มและมีจุดหยุดพักถ่ายรูปหลายจุด",
    review_note: "รูปเส้นทางมีแล้ว แต่ขอเพิ่มภาพจุดพักที่เห็นแม่น้ำชัดกว่านี้",
  },
  {
    key: "na-mueang-weaving-community",
    title: "ชุมชนทอผ้าบ้านนาเมือง",
    category: "community",
    slug: "mock-na-mueang-weaving-community-20260404",
    latitude: 15.1972,
    longitude: 104.9144,
    map_url: "https://maps.google.com/?q=15.1972,104.9144",
    google_place_id: "mock-place-20260404-05",
    tags: ["ชุมชน", "ทอผ้า", "หัตถกรรม"],
    summary: "เก็บข้อมูลชุมชนทอผ้าบ้านนาเมือง เน้นขั้นตอนทอผ้า ลวดลายเด่น และภาพคนทำงานจริง",
    description_raw: "ลงพื้นที่ชุมชนทอผ้าบ้านนาเมือง ถ่ายภาพขั้นตอนการทอ ลวดลาย และบรรยากาศชุมชน",
    description_clean: "งานภาคสนามชุมชนทอผ้าบ้านนาเมือง พร้อมภาพกระบวนการและคำอธิบายจุดเด่น",
    meta_title: "Mock งานลงพื้นที่ชุมชนทอผ้าบ้านนาเมือง",
    meta_description: "ข้อมูลทดสอบชุมชนทอผ้าบ้านนาเมือง พร้อมรูป วิดีโอ และคำตอบภาคสนาม",
    story_angle: "งานหัตถกรรมที่ยังมีคนทำจริงและเชื่อมโยงกับเศรษฐกิจชุมชน",
    social_hook: "อยากเห็นผ้าทอไม่ได้อยู่แค่ในร้าน ต้องมาดูถึงชุมชนที่ยังทอจริง",
    verified_facts: ["มีการทอผ้าจริงในชุมชน", "ลวดลายเด่นผูกกับอัตลักษณ์ท้องถิ่น"],
    questions: ["ลายผ้าที่คนถามถึงบ่อยที่สุดคือลายอะไร", "กระบวนการไหนที่ใช้เวลานานที่สุดก่อนออกมาเป็นผืนผ้า"],
    captures: ["ภาพคนทอผ้าในมุมทำงานจริง", "ภาพ close-up ลายผ้า", "คลิปมือกำลังทอผ้า"],
    additional_text: "หัวหน้ากลุ่มแนะนำให้เน้นเรื่องเวลาที่ใช้ทำหนึ่งผืนและความต่างของลวดลาย",
    review_note: "ต้องการคลิปที่เห็นมือและฟืมทอผ้าชัดกว่านี้เพื่อนำไปตัดสั้นลงโซเชียล",
  },
];

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2$${salt}$${digest}`;
}

function toPublicMediaUrl(storagePath) {
  return `/media/${String(storagePath || "").replace(/\\/g, "/")}`;
}

function toAbsoluteLocalMediaUrl(publicUrl) {
  const normalized = String(publicUrl || "").trim();
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `${LOCAL_MEDIA_BASE_URL}${normalized.startsWith("/") ? "" : "/"}${normalized}`;
}

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function walkFiles(rootPath) {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
  return out;
}

function listSampleImages() {
  const uploadsDir = path.join(dirs.mediaDir, "uploads");
  if (!fs.existsSync(uploadsDir)) {
    throw new Error(`uploads directory not found: ${uploadsDir}`);
  }
  return walkFiles(uploadsDir)
    .filter((filePath) => REQUIRED_IMAGE_EXTS.has(path.extname(filePath).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

function getRequiredUserByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const row = db.prepare("SELECT * FROM users WHERE email=? LIMIT 1").get(normalizedEmail);
  if (!row?.id) {
    throw new Error(`required user account not found: ${normalizedEmail}`);
  }
  return row;
}

function findItemIdBySourceUrl(sourceUrl) {
  const row = db.prepare(`
    SELECT sr.content_item_id
    FROM source_records sr
    JOIN content_items ci ON ci.id=sr.content_item_id
    WHERE sr.source_url=? AND ci.is_deleted=0
    ORDER BY sr.id DESC
    LIMIT 1
  `).get(sourceUrl);
  return Number(row?.content_item_id || 0) || null;
}

function buildFieldPack(job) {
  return {
    status: "field_in_progress",
    is_current: 1,
    ai_summary: `Mock brief สำหรับ ${job.title}`,
    ai_highlights_json: [`เน้นมุม ${job.story_angle}`, "ต้องมีภาพใช้งานได้ทั้งแนวตั้งและแนวนอน"],
    ai_unknowns_json: ["จำนวนผู้ใช้บริการต่อวัน", "ช่วงเวลาพีคที่แน่นอนจากคนในพื้นที่"],
    editor_summary: job.summary,
    verified_facts_json: job.verified_facts,
    uncertain_facts_json: ["ตัวเลขปริมาณผู้ใช้บริการรายวันยังต้องถามซ้ำในพื้นที่"],
    story_angle: job.story_angle,
    field_notes: `Mock note: ${job.title} ต้องเก็บทั้งภาพกว้างและมุมใช้งานจริง`,
    social_hook: job.social_hook,
    social_shot_emphasis_json: job.captures,
    social_on_camera_points_json: ["เปิดด้วยภาพรวมสถานที่", "ตามด้วยข้อมูลเด่นที่คนทั่วไปอยากรู้"],
    social_caption_angle: `มุมเล่าแบบแนะนำสถานที่: ${job.story_angle}`,
    writer_ready: 0,
    writer_angle: `ถ้าเขียนต่อให้จับประเด็น ${job.story_angle}`,
    writer_key_points_json: ["ต้องมีประสบการณ์จริงจากหน้างาน", "ต้องอ้างอิงคำพูดหรือ observation จากพื้นที่"],
    writer_notes: "ยังไม่ต้องส่งต่อ writer จนกว่าจะได้ภาพและคำตอบภาคสนามรอบแก้กลับครบ",
    field_pack_checklists: [
      ...job.verified_facts.map((text, index) => ({
        checklist_type: "must_verify_fact",
        item_text: text,
        item_order: index,
        status: "done",
        note: "mock verified",
      })),
      ...job.questions.map((text, index) => ({
        checklist_type: "must_ask_question",
        item_text: text,
        item_order: index,
        status: "done",
        note: "mock answered",
      })),
      ...job.captures.map((text, index) => ({
        checklist_type: "must_capture_shot",
        item_text: text,
        item_order: index,
        status: "doing",
        note: "mock capture available in latest submission",
      })),
    ],
    field_pack_references: [
      {
        reference_scope: "general",
        label: `${job.title} reference`,
        url: `https://example.com/mock/${job.key}`,
        source_family: "manual",
        note: "mock reference for testing",
        item_order: 0,
      },
      {
        reference_scope: "writer",
        label: `${job.title} background notes`,
        url: `https://example.com/mock/${job.key}/background`,
        source_family: "manual",
        note: "mock writer reference for testing",
        item_order: 1,
      },
    ],
  };
}

function ensureContentAssetForItem(contentItemId, absolutePath, { role = "gallery", isCover = 0, placementType = "gallery", sortOrder = 0 } = {}) {
  const relativePath = path.relative(dirs.mediaDir, absolutePath);
  const existing = db.prepare(`
    SELECT
      ca.id AS content_asset_id,
      ca.asset_id,
      a.storage_path,
      a.file_name,
      a.mime_type
    FROM content_assets ca
    JOIN assets a ON a.id=ca.asset_id
    WHERE ca.content_item_id=? AND a.storage_path=?
    ORDER BY ca.id ASC
    LIMIT 1
  `).get(contentItemId, relativePath);

  if (existing) {
    db.prepare(`
      UPDATE content_assets
      SET role=?, selected_in_clean=1, is_cover=?, placement_type=?, sort_order=?
      WHERE id=?
    `).run(role, isCover, placementType, sortOrder, Number(existing.content_asset_id));
    return {
      content_asset_id: Number(existing.content_asset_id),
      asset_id: Number(existing.asset_id),
      public_url: toPublicMediaUrl(relativePath),
      mime_type: String(existing.mime_type || "").trim() || guessMimeType(absolutePath),
      file_name: String(existing.file_name || path.basename(absolutePath)).trim(),
    };
  }

  const fileBuffer = fs.readFileSync(absolutePath);
  const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const stat = fs.statSync(absolutePath);
  const mimeType = guessMimeType(absolutePath);
  const assetUid = crypto.randomUUID();
  const assetResult = db.prepare(`
    INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
    VALUES (?, 'local', ?, ?, ?, ?, ?)
  `).run(assetUid, relativePath, path.basename(absolutePath), mimeType, Number(stat.size || 0), checksum);
  const assetId = Number(assetResult.lastInsertRowid || 0);
  const contentAssetResult = db.prepare(`
    INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
    VALUES (?, ?, ?, 1, ?, ?, ?)
  `).run(contentItemId, assetId, role, isCover, placementType, sortOrder);
  return {
    content_asset_id: Number(contentAssetResult.lastInsertRowid || 0),
    asset_id: assetId,
    public_url: toPublicMediaUrl(relativePath),
    mime_type: mimeType,
    file_name: path.basename(absolutePath),
  };
}

function findMockAssignment(contentItemId) {
  return db.prepare(`
    SELECT *
    FROM content_assignments
    WHERE content_item_id=? AND internal_note LIKE ?
    ORDER BY id DESC
    LIMIT 1
  `).get(contentItemId, `%${SEED_MARKER}%`);
}

function buildMediaPayloadAssets(imageAssets) {
  const imagePayload = imageAssets.map((asset) => ({
    id: asset.asset_id,
    file_name: asset.file_name,
    mime_type: asset.mime_type,
    public_url: asset.public_url,
  }));
  return [
    ...imagePayload,
    {
      id: null,
      file_name: "sample-flower.mp4",
      mime_type: "video/mp4",
      public_url: VIDEO_URL,
    },
  ];
}

function ensureItemAndFieldPack(job, coverImageUrl) {
  const sourceUrl = `https://example.com/mock/work-stage/${job.key}`;
  const existingItemId = findItemIdBySourceUrl(sourceUrl);
  return repo.saveItemWithFieldPack(
    {
      id: existingItemId || undefined,
      type: "place",
      category: job.category,
      lang: "th",
      title: job.title,
      slug: job.slug,
      description_raw: job.description_raw,
      description_clean: job.description_clean,
      summary: job.summary,
      meta_title: job.meta_title,
      meta_description: job.meta_description,
      latitude: job.latitude,
      longitude: job.longitude,
      map_url: job.map_url,
      google_place_id: job.google_place_id,
      image_url: coverImageUrl,
      tags: [...job.tags, "mock-seed", "work-stage"],
      workflow_status: "content_in_progress",
      source_type: "mock_seed",
      source_name: "mock_work_stage_seed",
      source_url: sourceUrl,
    },
    buildFieldPack(job),
    SEED_ACTOR_EMAIL
  );
}

function ensureSubmissionRow(assignment, job, assigneeUserId, mediaPayloadAssets) {
  const latestSubmissionId = Number(assignment?.latest_submission_id || 0) || 0;
  const articlePayload = {
    verified_answers: job.verified_facts.map((prompt) => ({ prompt, answer: `ยืนยันแล้วจากหน้างาน: ${prompt}` })),
    question_answers: job.questions.map((prompt, index) => ({ prompt, answer: `คำตอบ mock ลำดับ ${index + 1} สำหรับ: ${prompt}` })),
    additional_text: job.additional_text,
  };

  if (latestSubmissionId > 0) {
    db.prepare(`
      UPDATE content_assignment_submissions
      SET submitted_by_user_id=?, article_payload_json=?, media_payload_json=?, contributor_note=?, reviewer_note=?, reviewed_at=?
      WHERE id=?
    `).run(
      assigneeUserId,
      JSON.stringify(articlePayload),
      JSON.stringify({ assets: mediaPayloadAssets }),
      `Mock submission note for ${job.title}`,
      job.review_note,
      "2026-04-04T09:30:00+07:00",
      latestSubmissionId
    );
    return db.prepare("SELECT * FROM content_assignment_submissions WHERE id=? LIMIT 1").get(latestSubmissionId);
  }

  const submission = repo.addAssignmentSubmission({
    assignment_id: Number(assignment.id),
    submitted_by_user_id: assigneeUserId,
    submission_state: "submitted",
    article_payload_json: articlePayload,
    media_payload_json: { assets: mediaPayloadAssets },
    contributor_note: `Mock submission note for ${job.title}`,
    reviewer_note: job.review_note,
    reviewed_at: "2026-04-04T09:30:00+07:00",
  });
  repo.updateAssignmentState(Number(assignment.id), "submitted", SEED_ACTOR_EMAIL, {
    actor_role: "user",
    reason_code: "mock_seed_submission",
    internal_note: `mock seed transitioned to submitted | ${SEED_MARKER}`,
  });
  return submission;
}

function cleanupMockUsers() {
  for (const email of MOCK_USER_EMAILS) {
    const user = db.prepare("SELECT id FROM users WHERE email=? LIMIT 1").get(email);
    if (!user?.id) continue;
    const userId = Number(user.id || 0);
    const refCounts = {
      assignments_as_assignee: Number(db.prepare("SELECT COUNT(*) AS c FROM content_assignments WHERE assignee_user_id=?").get(userId)?.c || 0),
      assignments_as_assigner: Number(db.prepare("SELECT COUNT(*) AS c FROM content_assignments WHERE assigned_by_user_id=?").get(userId)?.c || 0),
      submissions: Number(db.prepare("SELECT COUNT(*) AS c FROM content_assignment_submissions WHERE submitted_by_user_id=?").get(userId)?.c || 0),
      field_pack_assignments: Number(db.prepare("SELECT COUNT(*) AS c FROM field_pack_assignments WHERE assigned_user_id=?").get(userId)?.c || 0),
      managed_users: Number(db.prepare("SELECT COUNT(*) AS c FROM users WHERE managed_by_user_id=?").get(userId)?.c || 0),
    };
    const totalRefs = Object.values(refCounts).reduce((sum, value) => sum + Number(value || 0), 0);
    if (totalRefs > 0) continue;
    db.prepare("DELETE FROM users WHERE id=?").run(userId);
  }
}

function buildInClause(values = []) {
  return Array.from({ length: values.length }, () => "?").join(",");
}

function repointHistoricalMockReferences(targetUser, itemIds = [], assignmentIds = []) {
  const safeItemIds = itemIds.map((value) => Number(value || 0)).filter((value) => value > 0);
  const safeAssignmentIds = assignmentIds.map((value) => Number(value || 0)).filter((value) => value > 0);
  if (!safeItemIds.length && !safeAssignmentIds.length) return;

  if (safeAssignmentIds.length > 0) {
    db.prepare(`
      UPDATE content_assignments
      SET assignee_user_id=?, assigned_by_user_id=?, updated_at=CURRENT_TIMESTAMP
      WHERE id IN (${buildInClause(safeAssignmentIds)})
    `).run(Number(targetUser.id), Number(targetUser.id), ...safeAssignmentIds);

    db.prepare(`
      UPDATE content_assignment_submissions
      SET submitted_by_user_id=?
      WHERE assignment_id IN (${buildInClause(safeAssignmentIds)})
    `).run(Number(targetUser.id), ...safeAssignmentIds);
  }

  if (safeItemIds.length > 0) {
    db.prepare(`
      UPDATE field_pack_assignments
      SET assigned_user_id=?, assigned_name=?, assigned_role=?, updated_at=CURRENT_TIMESTAMP
      WHERE field_pack_id IN (
        SELECT id FROM field_packs WHERE content_item_id IN (${buildInClause(safeItemIds)})
      )
    `).run(
      Number(targetUser.id),
      String(targetUser.display_name || targetUser.email || ""),
      String(targetUser.role || "user"),
      ...safeItemIds
    );
  }

  const mockUserRows = db.prepare(`
    SELECT id
    FROM users
    WHERE email IN (${buildInClause(MOCK_USER_EMAILS)})
  `).all(...MOCK_USER_EMAILS);
  const mockUserIds = mockUserRows.map((row) => Number(row.id || 0)).filter((value) => value > 0);
  if (mockUserIds.length > 0) {
    db.prepare(`
      UPDATE users
      SET managed_by_user_id=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE id IN (${buildInClause(mockUserIds)})
    `).run(...mockUserIds);
  }
}

function ensureDeliverable(assignmentId, submissionId, contentItemId, payload) {
  const sourceAssetId = payload.source_asset_id == null ? null : Number(payload.source_asset_id || 0) || null;
  const sourceUrl = String(payload.source_url || "").trim() || null;
  const existing = db.prepare(`
    SELECT id
    FROM content_assignment_submission_deliverables
    WHERE assignment_id=? AND submission_id=? AND deliverable_type=?
      AND COALESCE(source_asset_id, 0)=COALESCE(?, 0)
      AND COALESCE(source_url, '')=COALESCE(?, '')
      AND COALESCE(title, '')=COALESCE(?, '')
    ORDER BY id DESC
    LIMIT 1
  `).get(assignmentId, submissionId, payload.deliverable_type, sourceAssetId, sourceUrl, payload.title || null);

  if (existing?.id) {
    db.prepare(`
      UPDATE content_assignment_submission_deliverables
      SET text_content=?, payload_json=?, status=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      payload.text_content == null ? null : String(payload.text_content),
      payload.payload_json == null ? null : JSON.stringify(payload.payload_json),
      payload.status || "submitted",
      Number(existing.id)
    );
    return Number(existing.id);
  }

  const deliverable = repo.createAssignmentSubmissionDeliverable({
    assignment_id: assignmentId,
    submission_id: submissionId,
    content_item_id: contentItemId,
    deliverable_type: payload.deliverable_type,
    title: payload.title || null,
    lang: "th",
    text_content: payload.text_content || null,
    payload_json: payload.payload_json || null,
    source_asset_id: sourceAssetId,
    source_url: sourceUrl,
    status: payload.status || "submitted",
  }, SEED_ACTOR_EMAIL);
  return Number(deliverable?.id || 0);
}

function ensureRevisionRequested(assignmentId, reviewNote) {
  const current = repo.getAssignmentById(assignmentId);
  const currentState = String(current?.state || "").trim().toLowerCase();
  if (currentState === "revision_requested") {
    db.prepare(`
      UPDATE content_assignments
      SET contributor_note=?, internal_note=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(reviewNote, `${SEED_MARKER} | reviewer requested revision`, assignmentId);
    return repo.getAssignmentById(assignmentId);
  }
  return repo.updateAssignmentState(assignmentId, "revision_requested", SEED_ACTOR_EMAIL, {
    actor_role: "user",
    reason_code: "mock_seed_revision_requested",
    contributor_note: reviewNote,
    internal_note: `${SEED_MARKER} | reviewer requested revision`,
  });
}

function main() {
  const sampleImages = listSampleImages();
  if (sampleImages.length < 15) {
    throw new Error(`need at least 15 sample images under ${path.join(dirs.mediaDir, "uploads")}`);
  }

  const targetUser = getRequiredUserByEmail(TARGET_EMAIL);

  const summary = [];
  const itemIds = [];
  const assignmentIds = [];

  JOBS.forEach((job, index) => {
    const imageStart = index * 3;
    const selectedImages = sampleImages.slice(imageStart, imageStart + (index < 3 ? 3 : 2));
    const coverRelative = path.relative(dirs.mediaDir, selectedImages[0]);
    const coverPublicUrl = toPublicMediaUrl(coverRelative);

    const saved = ensureItemAndFieldPack(job, coverPublicUrl);
    const itemId = Number(saved?.item?.id || 0);
    if (!itemId) throw new Error(`failed to save item for ${job.title}`);
    itemIds.push(itemId);

    const imageAssets = selectedImages.map((filePath, imageIndex) => ensureContentAssetForItem(itemId, filePath, {
      role: imageIndex === 0 ? "cover" : "gallery",
      isCover: imageIndex === 0 ? 1 : 0,
      placementType: imageIndex === 0 ? "cover" : "gallery",
      sortOrder: imageIndex,
    }));

    if (saved?.field_pack?.id) {
      repo.updateFieldPack(saved.field_pack.id, {
        field_pack_media_hints: imageAssets.map((asset, imageIndex) => ({
          content_asset_id: asset.content_asset_id,
          url: toAbsoluteLocalMediaUrl(asset.public_url),
          kind: imageIndex === 0 ? "cover" : "gallery",
          caption: `${job.title} image ${imageIndex + 1}`,
          selected: imageIndex === 0 ? 1 : 0,
          item_order: imageIndex,
        })),
        updated_by: SEED_ACTOR_EMAIL,
      });
    }

    let assignment = findMockAssignment(itemId);
    const briefJson = {
      seed_marker: SEED_MARKER,
      assignment_focus: job.story_angle,
      expected_deliverables: ["photos", "videos", "raw_notes"],
      location_note: job.summary,
      contact_window: "06:00-18:00",
      revision_goal: job.review_note,
    };
    const requirementsJson = {
      expected_deliverables: ["photos", "videos", "raw_notes"],
      minimum_photo_count: imageAssets.length,
      minimum_video_count: 1,
      required_orientation: ["landscape", "portrait"],
      field_scope: "mock testing",
    };
    const dueAt = `2026-04-${String(10 + index).padStart(2, "0")}T17:00:00+07:00`;

    if (!assignment) {
      assignment = repo.createAssignment({
        content_item_id: itemId,
        assignment_kind: "field",
        assignee_user_id: Number(targetUser.id),
        state: "assigned",
        brief_json: briefJson,
        requirements_json: requirementsJson,
        due_at: dueAt,
        contributor_note: "Mock assignment created for work-stage testing",
        internal_note: `${SEED_MARKER} | initial assignment`,
      }, Number(targetUser.id), {
        actor_email: SEED_ACTOR_EMAIL,
        actor_role: "user",
        reason_code: "mock_seed_assignment_created",
        note: "mock work-stage seed",
      });
    } else {
      db.prepare(`
        UPDATE content_assignments
        SET assignee_user_id=?, assigned_by_user_id=?, brief_json=?, requirements_json=?, due_at=?, contributor_note=?, internal_note=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(
        Number(targetUser.id),
        Number(targetUser.id),
        JSON.stringify(briefJson),
        JSON.stringify(requirementsJson),
        dueAt,
        "Mock assignment refreshed for work-stage testing",
        `${SEED_MARKER} | refreshed assignment`,
        Number(assignment.id)
      );
      assignment = repo.getAssignmentById(Number(assignment.id));
    }

    if (saved?.field_pack?.id) {
      repo.replaceFieldPackAssignments(saved.field_pack.id, [
        {
          assignment_scope: "field",
          linked_assignment_id: Number(assignment.id),
          assigned_user_id: Number(targetUser.id),
          assigned_name: String(targetUser.display_name || ""),
          assigned_role: String(targetUser.role || "user"),
          assigned_at: `2026-04-${String(5 + index).padStart(2, "0")}T09:00:00+07:00`,
          due_at: dueAt,
          note: "mock field assignment linkage",
        },
      ]);
    }

    const mediaPayloadAssets = buildMediaPayloadAssets(imageAssets);
    const submission = ensureSubmissionRow(assignment, job, Number(targetUser.id), mediaPayloadAssets);
    const submissionId = Number(submission?.id || 0);
    if (!submissionId) throw new Error(`failed to create submission for assignment ${assignment.id}`);
    assignmentIds.push(Number(assignment.id));

    imageAssets.forEach((asset, assetIndex) => {
      ensureDeliverable(Number(assignment.id), submissionId, itemId, {
        deliverable_type: "photos",
        title: `${job.title} photo ${assetIndex + 1}`,
        source_asset_id: asset.asset_id,
        payload_json: {
          caption: `${job.title} photo ${assetIndex + 1}`,
          placement_hint: assetIndex === 0 ? "cover" : "gallery",
        },
        status: "submitted",
      });
    });

    ensureDeliverable(Number(assignment.id), submissionId, itemId, {
      deliverable_type: "videos",
      title: VIDEO_TITLE,
      source_url: VIDEO_URL,
      payload_json: {
        note: "remote sample video for UI testing",
        source: "mdn",
      },
      status: "submitted",
    });
    ensureDeliverable(Number(assignment.id), submissionId, itemId, {
      deliverable_type: "raw_notes",
      title: `${job.title} raw notes`,
      text_content: `${job.additional_text}\n\nประเด็นที่ต้องกลับไปแก้: ${job.review_note}`,
      payload_json: { source: "mock field notes" },
      status: "submitted",
    });
    ensureDeliverable(Number(assignment.id), submissionId, itemId, {
      deliverable_type: "caption_draft",
      title: `${job.title} caption draft`,
      text_content: `${job.social_hook}\n\nรายละเอียดสั้นสำหรับโพสต์ทดสอบ`,
      payload_json: { channel: "facebook" },
      status: "submitted",
    });
    ensureDeliverable(Number(assignment.id), submissionId, itemId, {
      deliverable_type: "script_draft",
      title: `${job.title} script draft`,
      text_content: `เปิดคลิปด้วยภาพรวม แล้วเล่าประเด็น "${job.story_angle}" ภายใน 30 วินาที`,
      payload_json: { duration_sec: 30 },
      status: "submitted",
    });
    ensureDeliverable(Number(assignment.id), submissionId, itemId, {
      deliverable_type: "article_draft",
      title: `${job.title} article draft`,
      text_content: `${job.summary}\n\nย่อหน้าเปิดต้นฉบับสำหรับทดสอบ writer handoff`,
      payload_json: { format: "teaser" },
      status: "submitted",
    });

    const finalAssignment = ensureRevisionRequested(Number(assignment.id), job.review_note);
    const bundle = repo.getLatestAssignmentDeliverablesBundle(Number(assignment.id));
    summary.push({
      item_id: itemId,
      assignment_id: Number(finalAssignment?.id || assignment.id),
      assignment_state: String(finalAssignment?.state || ""),
      latest_submission_id: Number(finalAssignment?.latest_submission_id || submissionId || 0),
      title: job.title,
      assignee_email: String(targetUser.email || ""),
      image_count: imageAssets.length,
      video_count: 1,
      expected_deliverables: bundle?.expected_deliverables || [],
      available_deliverable_types: bundle?.available_deliverable_types || [],
    });
  });

  repointHistoricalMockReferences(targetUser, itemIds, assignmentIds);
  cleanupMockUsers();

  console.log(JSON.stringify({
    ok: true,
    seed_marker: SEED_MARKER,
    db_path: dirs.dbPath,
    target_user: {
      id: Number(targetUser.id || 0),
      email: String(targetUser.email || ""),
      role: String(targetUser.role || ""),
    },
    jobs: summary,
  }, null, 2));
}

try {
  main();
} finally {
  db.close();
}
