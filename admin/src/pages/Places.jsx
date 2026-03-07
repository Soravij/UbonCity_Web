import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, authHeaders } from "../api/api";

const CATEGORIES = ["attractions", "activities", "hotels", "cafes", "restaurants", "transport"];
const CATEGORY_LABEL = {
  attractions: "สถานที่ท่องเที่ยว",
  activities: "กิจกรรม",
  hotels: "โรงแรม",
  cafes: "คาเฟ่",
  restaurants: "ร้านอาหาร",
  transport: "การเดินทาง",
};

const EMPTY = { category: "attractions", title: "", description: "", meta_title: "", meta_description: "", image: "" };

function normalizeRotation(rotation) {
  const n = Number(rotation);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

function previewRotationTransform(rotation) {
  const rot = normalizeRotation(rotation);
  return `rotate(${rot}deg)`;
}

function parseAltRotation(rawAlt) {
  const input = String(rawAlt || "").trim();
  const match = input.match(/^(.*?)(?:\|r=(-?\d+))?$/);
  return {
    alt: String(match?.[1] || "").trim(),
    rotation: normalizeRotation(match?.[2] ?? 0),
  };
}

function splitContentBlocks(text) {
  const source = String(text || "");
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const blocks = [];
  let lastIndex = 0;
  let imageOrder = 0;

  for (const match of source.matchAll(regex)) {
    const full = match[0];
    const url = (match[2] || "").trim();
    const index = match.index ?? 0;
    const parsedAlt = parseAltRotation(match[1]);

    if (index > lastIndex) {
      const textBlock = source.slice(lastIndex, index).trim();
      if (textBlock) blocks.push({ type: "text", value: textBlock });
    }

    if (url) {
      blocks.push({
        type: "image",
        src: url,
        alt: parsedAlt.alt || "🖼️ รูปประกอบ",
        rotation: parsedAlt.rotation,
        imageOrder,
      });
      imageOrder += 1;
    }

    lastIndex = index + full.length;
  }

  if (lastIndex < source.length) {
    const textBlock = source.slice(lastIndex).trim();
    if (textBlock) blocks.push({ type: "text", value: textBlock });
  }

  if (!blocks.length && source.trim()) {
    blocks.push({ type: "text", value: source.trim() });
  }

  return blocks;
}

function InlineThumb({ src, alt, rotation }) {
  const [previewSrc, setPreviewSrc] = useState(String(src || ""));

  useEffect(() => {
    let active = true;
    const source = String(src || "").trim();
    const rot = normalizeRotation(rotation);

    if (!source) {
      setPreviewSrc("");
      return () => {
        active = false;
      };
    }

    if (rot === 0) {
      setPreviewSrc(source);
      return () => {
        active = false;
      };
    }

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      if (!active) return;

      const w = Number(img.naturalWidth || 0);
      const h = Number(img.naturalHeight || 0);
      if (w <= 0 || h <= 0) {
        setPreviewSrc(source);
        return;
      }

      const quarterTurn = rot === 90 || rot === 270;
      const canvas = document.createElement("canvas");
      canvas.width = quarterTurn ? h : w;
      canvas.height = quarterTurn ? w : h;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setPreviewSrc(source);
        return;
      }

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);

      try {
        const dataUrl = canvas.toDataURL("image/png");
        setPreviewSrc(dataUrl || source);
      } catch {
        setPreviewSrc(source);
      }
    };

    img.onerror = () => {
      if (!active) return;
      setPreviewSrc(source);
    };

    img.src = source;

    return () => {
      active = false;
    };
  }, [src, rotation]);

  return <img src={previewSrc || src} alt={alt || "🖼️ รูปประกอบ"} className="inline-image-thumb" />;
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

function extractBase64(dataUrl) {
  const value = String(dataUrl || "");
  return value.includes(",") ? value.split(",")[1] : value;
}

function estimateBase64Bytes(base64) {
  return Math.floor((String(base64 || "").length * 3) / 4);
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("โหลดรูปไม่สำเร็จ"));
    img.src = dataUrl;
  });
}

async function compressImageForUpload(file) {
  const originalDataUrl = await readFileAsDataUrl(file);
  const originalBase64 = extractBase64(originalDataUrl);
  const originalMime = String(file?.type || "").toLowerCase();

  if (!originalMime.startsWith("image/")) {
    return { base64: originalBase64, mimeType: originalMime || "application/octet-stream" };
  }

  // Keep GIF as-is to avoid breaking animation.
  if (originalMime === "image/gif") {
    return { base64: originalBase64, mimeType: originalMime };
  }

  try {
    const img = await loadImageFromDataUrl(originalDataUrl);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const targetW = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const targetH = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      return { base64: originalBase64, mimeType: originalMime || "image/jpeg" };
    }

    ctx.drawImage(img, 0, 0, targetW, targetH);

    const outputMime = originalMime === "image/png" ? "image/webp" : "image/jpeg";
    const quality = outputMime === "image/webp" ? 0.82 : 0.8;
    const compressedDataUrl = canvas.toDataURL(outputMime, quality);
    const compressedBase64 = extractBase64(compressedDataUrl);

    if (estimateBase64Bytes(compressedBase64) < estimateBase64Bytes(originalBase64)) {
      return { base64: compressedBase64, mimeType: outputMime };
    }

    return { base64: originalBase64, mimeType: originalMime || outputMime };
  } catch {
    return { base64: originalBase64, mimeType: originalMime || "image/jpeg" };
  }
}

function buildImageMarkdown(url, alt, rotation) {
  const cleanUrl = String(url || "").trim();
  const cleanAlt = String(alt || "🖼️ รูปประกอบลำดับ 1").trim() || "🖼️ รูปประกอบลำดับ 1";
  const rot = normalizeRotation(rotation);
  const altWithRotation = rot ? `${cleanAlt}|r=${rot}` : cleanAlt;
  return `\n![${altWithRotation}](${cleanUrl})\n`;
}


function parseCoverImageValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return { url: "", rotation: 0 };

  const match = value.match(/^(.*?)(?:#r=(-?\d+))?$/);
  return {
    url: String(match?.[1] || "").trim(),
    rotation: normalizeRotation(match?.[2] ?? 0),
  };
}

function buildCoverImageValue(url, rotation) {
  const cleanUrl = String(url || "").trim();
  const rot = normalizeRotation(rotation);
  if (!cleanUrl) return "";
  return rot ? `${cleanUrl}#r=${rot}` : cleanUrl;
}

function removeImageMarkdownByOrder(text, targetOrder) {
  const source = String(text || "");
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;

  let currentOrder = 0;
  let removed = false;
  let output = "";
  let lastIndex = 0;

  for (const match of source.matchAll(regex)) {
    const index = match.index ?? 0;
    const full = match[0];
    const end = index + full.length;

    if (currentOrder === targetOrder) {
      removed = true;
      output += source.slice(lastIndex, index);
    } else {
      output += source.slice(lastIndex, index) + full;
    }

    currentOrder += 1;
    lastIndex = end;
  }

  output += source.slice(lastIndex);
  return removed ? output.replace(/\n{3,}/g, "\n\n").trim() : source;
}

function countImageUrlOccurrences(text, targetUrl) {
  const source = String(text || "");
  const url = String(targetUrl || "").trim();
  if (!url) return 0;

  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  let count = 0;

  for (const match of source.matchAll(regex)) {
    const current = String(match?.[1] || "").trim();
    if (current === url) count += 1;
  }

  return count;
}


function withRotationInAlt(baseAlt, rotation) {
  const rot = normalizeRotation(rotation);
  return rot ? `${baseAlt}|r=${rot}` : baseAlt;
}

function renumberImageMarkdownLabels(text) {
  const source = String(text || "");
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let order = 0;

  return source.replace(regex, (_full, rawAlt, url) => {
    const parsed = parseAltRotation(rawAlt);
    const nextAlt = withRotationInAlt(`🖼️ รูปประกอบลำดับ ${order + 1}`, parsed.rotation);
    order += 1;
    return `![${nextAlt}](${String(url || "").trim()})`;
  });
}
export default function Places({ token, role = "user", mode = "create" }) {
  const [form, setForm] = useState(EMPTY);
  const [items, setItems] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [message, setMessage] = useState("");

  const [translateModalOpen, setTranslateModalOpen] = useState(false);
  const [previewWindowOpen, setPreviewWindowOpen] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translated, setTranslated] = useState({});

  const [insertImageModalOpen, setInsertImageModalOpen] = useState(false);
  const [insertImageUrl, setInsertImageUrl] = useState("");
  const [insertImageAlt, setInsertImageAlt] = useState("🖼️ รูปประกอบลำดับ 1");
  const [insertImageRotation, setInsertImageRotation] = useState(0);
  const [uploadingInline, setUploadingInline] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [coverImageModalOpen, setCoverImageModalOpen] = useState(false);
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [coverImageRotation, setCoverImageRotation] = useState(0);

  const descriptionRef = useRef(null);

  const isEdit = mode === "edit";
  const isEditing = useMemo(() => editingId !== null, [editingId]);
  const descriptionBlocks = useMemo(() => splitContentBlocks(form.description), [form.description]);
  const coverPreview = useMemo(() => parseCoverImageValue(form.image), [form.image]);

  const previewFirstImageIndex = useMemo(
    () => descriptionBlocks.findIndex((b) => b.type === "image"),
    [descriptionBlocks]
  );

  const previewFirstImage = useMemo(
    () => (previewFirstImageIndex >= 0 ? descriptionBlocks[previewFirstImageIndex] : null),
    [descriptionBlocks, previewFirstImageIndex]
  );

  const previewCoverUrl = coverPreview.url || previewFirstImage?.src || "";
  const previewCoverRotation = coverPreview.url ? coverPreview.rotation : previewFirstImage?.rotation || 0;

  const previewContentBlocks = useMemo(() => {
    if (!coverPreview.url && previewFirstImageIndex >= 0) {
      return descriptionBlocks.filter((block, index) => !(block.type === "image" && index === previewFirstImageIndex));
    }
    return descriptionBlocks;
  }, [coverPreview.url, descriptionBlocks, previewFirstImageIndex]);

  const loadPlaces = useCallback(async () => {
    if (!isEdit) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await api.get("/places", {
        params: { category: form.category, lang: "th", include_unapproved: 1 },
        headers: authHeaders(token),
      });
      setItems(Array.isArray(res.data?.items) ? res.data.items : []);
    } catch (e) {
      setMessage(e?.response?.data?.error || e?.message || "โหลดรายการไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [form.category, isEdit, token]);

  useEffect(() => {
    loadPlaces();
  }, [loadPlaces]);

  async function runTranslation() {
    if (!form.title || !form.description) {
      setMessage("กรอกชื่อสถานที่และรายละเอียดก่อนแปลภาษา");
      return null;
    }

    setTranslating(true);
    try {
      const res = await api.post("/translate", {
        title: form.title,
        description: form.description,
        sourceLang: "th",
      });

      const result = res.data || {};
      setTranslated(result);
      return result;
    } catch (e) {
      setMessage(e?.response?.data?.error || e?.message || "แปลภาษาไม่สำเร็จ");
      return null;
    } finally {
      setTranslating(false);
    }
  }

  async function saveLanguageVersion(payload) {
    const res = await api.post("/places", payload, { headers: authHeaders(token) });
    return Number(res?.data?.place_id || payload.group_id || 0);
  }

  async function onSubmit(e) {
    e.preventDefault();

    if (!form.title || !form.description) {
      setMessage("กรอกชื่อสถานที่และรายละเอียดให้ครบ");
      return;
    }

    if (isEdit && !editingId) {
      setMessage("กรุณาเลือกรายการจากลิสต์ก่อนเข้าแก้ไข");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const thBody = {
        group_id: isEdit ? editingId : null,
        category: form.category,
        lang: "th",
        slug: "",
        title: form.title,
        description: form.description,
        meta_title: form.meta_title || form.title,
        meta_description: form.meta_description || form.description,
        image: form.image || null,
      };

      const placeId = await saveLanguageVersion(thBody);
      if (!placeId) throw new Error("ไม่พบ place_id หลังบันทึกภาษาไทย");

      if (isEdit) {
        setMessage(`อัปเดตเนื้อหา ID ${placeId} สำเร็จ (ภาษาอื่นจะสร้างตอนอนุมัติ)`);
        setEditingId(null);
        setForm((prev) => ({ ...EMPTY, category: prev.category }));
        await loadPlaces();
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setMessage("บันทึกสำเร็จ (ภาษาอื่นจะสร้างตอนอนุมัติ)");
        setForm(EMPTY);
      }

      setTranslated({});
    } catch (e) {
      setMessage(e?.response?.data?.error || e?.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function onDeletePlace(item) {
    if (role !== "admin") return;

    const ok = window.confirm(`ต้องการลบเนื้อหา ID ${item.id} ใช่หรือไม่?`);
    if (!ok) return;

    setDeletingId(item.id);
    setMessage("");

    try {
      await api.delete(`/places/${item.id}`, { headers: authHeaders(token) });
      setMessage(`ลบเนื้อหา ID ${item.id} แล้ว (ลบทุกภาษาที่เกี่ยวข้อง)`);

      if (editingId === item.id) {
        setEditingId(null);
        setForm((prev) => ({ ...EMPTY, category: prev.category }));
      }

      await loadPlaces();
    } catch (e) {
      setMessage(e?.response?.data?.error || e?.message || "ลบเนื้อหาไม่สำเร็จ");
    } finally {
      setDeletingId(null);
    }
  }
  function startEdit(item) {
    setEditingId(item.id);
    setForm({
      category: item.category || "attractions",
      title: item.title || "",
      description: renumberImageMarkdownLabels(item.description || ""),
      meta_title: item.meta_title || "",
      meta_description: item.meta_description || "",
      image: item.image || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function backToList() {
    const confirmed = window.confirm("การแก้ไขยังไม่ได้บันทึก ต้องการกลับไปหน้ารายการหรือไม่?");
    if (!confirmed) return;

    setEditingId(null);
    setForm((prev) => ({ ...EMPTY, category: prev.category }));
    setMessage("ยกเลิกการแก้ไขแล้ว (ยังไม่ได้บันทึก)");
  }

  function insertTextAtCursor(textToInsert) {
    const textarea = descriptionRef.current;
    if (!textarea) {
      setForm((prev) => ({ ...prev, description: `${prev.description}${textToInsert}` }));
      return;
    }

    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;

    setForm((prev) => {
      const next = `${prev.description.slice(0, start)}${textToInsert}${prev.description.slice(end)}`;
      return { ...prev, description: next };
    });

    requestAnimationFrame(() => {
      const nextPos = start + textToInsert.length;
      textarea.focus();
      textarea.setSelectionRange(nextPos, nextPos);
    });
  }

  function isManagedUploadUrl(url) {
    const value = String(url || "").trim();
    return /\/uploads\//i.test(value);
  }

  async function deleteUploadedFile(url) {
    const value = String(url || "").trim();
    if (!value || !isManagedUploadUrl(value)) return;

    try {
      await api.delete("/upload/image", {
        data: { url: value },
        headers: authHeaders(token),
      });
    } catch (err) {
      const status = Number(err?.response?.status || 0);
      const apiError = String(err?.response?.data?.error || "").toLowerCase();
      if (status === 404 || apiError.includes("file not found")) {
        return;
      }
      throw err;
    }
  }

  async function uploadImageFile(file) {
    if (!file) return "";
    const payload = await compressImageForUpload(file);

    const res = await api.post(
      "/upload/image",
      {
        dataBase64: payload.base64,
        mimeType: payload.mimeType,
      },
      { headers: authHeaders(token) }
    );

    const url = String(res.data?.url || "").trim();
    if (!url) throw new Error("อัปโหลดรูปไม่สำเร็จ");
    return url;
  }

  async function onCoverModalFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadingCover(true);
      const url = await uploadImageFile(file);
      setCoverImageUrl(url);
    } catch (err) {
      setMessage(err?.response?.data?.error || err?.message || "อัปโหลดรูปปกไม่สำเร็จ");
    } finally {
      setUploadingCover(false);
      e.target.value = "";
    }
  }

  async function onInlineFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadingInline(true);
      const url = await uploadImageFile(file);
      setInsertImageUrl(url);
    } catch (err) {
      setMessage(err?.response?.data?.error || err?.message || "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setUploadingInline(false);
      e.target.value = "";
    }
  }

  function onInsertImageAtCursor() {
    const cleanUrl = String(insertImageUrl || "").trim();
    if (!cleanUrl) {
      setMessage("กรุณาใส่ URL รูปภาพหรืออัปโหลดไฟล์ก่อน");
      return;
    }

    const nextOrder = descriptionBlocks.filter((b) => b.type === "image").length + 1;
    const defaultAlt = `🖼️ รูปประกอบลำดับ ${nextOrder}`;
    const markdown = buildImageMarkdown(cleanUrl, insertImageAlt || defaultAlt, insertImageRotation);
    insertTextAtCursor(markdown);
    setInsertImageUrl("");
    setInsertImageAlt(`🖼️ รูปประกอบลำดับ ${nextOrder + 1}`);
    setInsertImageRotation(0);
    setInsertImageModalOpen(false);
  }

  async function onOpenTranslateModal() {
    setTranslateModalOpen(true);
    setTranslated({});
    await runTranslation();
  }
  function onOpenCoverModal() {
    const parsed = parseCoverImageValue(form.image);
    setCoverImageUrl(parsed.url);
    setCoverImageRotation(parsed.rotation);
    setCoverImageModalOpen(true);
  }

  function onApplyCoverImage() {
    const cleanUrl = String(coverImageUrl || "").trim();
    if (!cleanUrl) {
      setMessage("กรุณาใส่ URL รูปปกหรืออัปโหลดไฟล์ก่อน");
      return;
    }

    setForm((prev) => ({ ...prev, image: buildCoverImageValue(cleanUrl, coverImageRotation) }));
    setCoverImageModalOpen(false);
  }

  function rotateInsertPreview(delta) {
    setInsertImageRotation((prev) => normalizeRotation(prev + delta));
  }

  useEffect(() => {
    if (!insertImageModalOpen) return;
    const nextOrder = descriptionBlocks.filter((b) => b.type === "image").length + 1;
    setInsertImageAlt(`🖼️ รูปประกอบลำดับ ${nextOrder}`);
  }, [insertImageModalOpen, descriptionBlocks]);

  async function onRemoveInlineImage(imageOrder, imageUrl) {
    const prevDescription = String(form.description || "");
    const nextDescription = renumberImageMarkdownLabels(removeImageMarkdownByOrder(prevDescription, imageOrder));
    const coverUrl = parseCoverImageValue(form.image).url;
    const currentCount = countImageUrlOccurrences(prevDescription, imageUrl);
    const nextCount = countImageUrlOccurrences(nextDescription, imageUrl);
    const shouldDeleteFile =
      currentCount > 0 && nextCount === 0 && String(coverUrl || "").trim() !== String(imageUrl || "").trim();

    if (shouldDeleteFile) {
      try {
        await deleteUploadedFile(imageUrl);
      } catch (err) {
        setMessage(err?.response?.data?.error || err?.message || "ลบไฟล์รูปภาพไม่สำเร็จ");
        return;
      }
    }

    setForm((prev) => ({ ...prev, description: nextDescription }));
    setMessage(
      shouldDeleteFile
        ? "ลบรูปประกอบและลบไฟล์ออกจากเซิร์ฟเวอร์แล้ว กดบันทึกเพื่ออัปเดต"
        : "ลบรูปประกอบออกจากเนื้อหาแล้ว กดบันทึกเพื่ออัปเดต"
    );
  }

  async function onRemoveCoverImage() {
    const targetUrl = String(form.image || "").trim();

    try {
      await deleteUploadedFile(targetUrl);
    } catch (err) {
      setMessage(err?.response?.data?.error || err?.message || "ลบไฟล์รูปปกไม่สำเร็จ");
      return;
    }

    setForm((prev) => ({ ...prev, image: "" }));
    setMessage("ลบรูปปกและลบไฟล์ออกจากเซิร์ฟเวอร์แล้ว กดบันทึกเพื่ออัปเดต");
  }

  return (
    <>
      {isEdit && !isEditing ? (
        <section className="admin-card">
          <div className="card-title-row">
            <h2>เลือกรายการเนื้อหาที่ต้องการแก้ไข (TH)</h2>
            <button type="button" className="ghost" onClick={loadPlaces} disabled={loading}>
              {loading ? "กำลังโหลด..." : "รีเฟรช"}
            </button>
          </div>

          <div className="grid two" style={{ marginBottom: 12 }}>
            <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <input value="ภาษาไทย (TH)" disabled />
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>ชื่อ</th>
                  <th>สถานะ</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.title}</td>
                    <td>{item.is_approved ? "อนุมัติแล้ว" : "รออนุมัติ"}</td>
                    <td className="actions">
                      <button type="button" className="ghost" onClick={() => startEdit(item)}>
                        เข้าแก้ไข
                      </button>
                      {role === "admin" ? (
                        <button
                          type="button"
                          className="danger"
                          onClick={() => onDeletePlace(item)}
                          disabled={deletingId === item.id}
                        >
                          {deletingId === item.id ? "กำลังลบ..." : "ลบ"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && items.length === 0 ? <p className="muted">ไม่พบรายการในหมวดนี้</p> : null}
        </section>
      ) : null}

      {!isEdit || isEditing ? (
        <section className="admin-card">
          <div className="card-title-row">
            <h2>
              {isEdit
                ? `หน้าแก้ไขเนื้อหา | ID: ${editingId} | ชื่อ: ${form.title || "-"}`
                : "สร้างเนื้อหา (TH)"}
            </h2>

          </div>

          <form className="grid two" onSubmit={onSubmit}>
            <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <input value="ภาษาไทย (TH)" disabled />

            <input
              className="full"
              placeholder="ชื่อสถานที่"
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              required
            />

            <div className="full content-toolbar">
              <button type="button" className="ghost" onClick={() => setInsertImageModalOpen(true)}>
                แทรกรูปที่ตำแหน่งเคอร์เซอร์
              </button>
              <button type="button" className="ghost" onClick={onOpenTranslateModal} disabled={translating}>
                {translating ? "กำลังแปล..." : "ตรวจสอบแปลภาษา"}
              </button>
              <button type="button" className="ghost" onClick={() => setPreviewWindowOpen(true)}>
                รีวิวหน้าสุดท้าย
              </button>
            </div>

            <textarea
              ref={descriptionRef}
              className="full"
              rows={10}
              placeholder="รายละเอียด"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              required
            />

            <div className="full inline-image-manager">
              <div className="card-title-row">
                <h3>รูปประกอบในเนื้อหา</h3>
              </div>
              {descriptionBlocks.filter((b) => b.type === "image").length === 0 ? (
                <p className="muted">ยังไม่มีรูปประกอบในเนื้อหา</p>
              ) : (
                <div className="inline-image-list">
                  {descriptionBlocks
                    .filter((b) => b.type === "image")
                    .map((img) => (
                      <div key={`inline-image-${img.imageOrder}-${img.src}`} className="inline-image-row">
                        <InlineThumb src={img.src} alt={img.alt || "🖼️ รูปประกอบ"} rotation={img.rotation || 0} />
                        <div className="inline-image-meta">
                          <p>ลำดับรูป: {Number(img.imageOrder) + 1}</p>
                          <p>มุมหมุน: {normalizeRotation(img.rotation || 0)}°</p>
                        </div>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => onRemoveInlineImage(img.imageOrder, img.src)}
                        >
                          ลบรูปประกอบ
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <input
              placeholder="เมตาไตเติล (SEO)"
              value={form.meta_title}
              onChange={(e) => setForm((p) => ({ ...p, meta_title: e.target.value }))}
            />

            <div className="cover-input-wrap">
              <input
                placeholder="ลิงก์รูปภาพปก"
                value={coverPreview.url}
                onChange={(e) => setForm((p) => ({ ...p, image: buildCoverImageValue(e.target.value, 0) }))}
              />
              <div className="cover-actions">
                <button type="button" className="ghost" onClick={onOpenCoverModal}>
                  ใส่รูปปก (แบบ popup)
                </button>
                {form.image ? (
                  <button type="button" className="danger" onClick={onRemoveCoverImage}>
                    ลบรูปปก
                  </button>
                ) : null}
              </div>
            </div>

            <textarea
              className="full"
              rows={3}
              placeholder="เมตาคำอธิบาย (SEO)"
              value={form.meta_description}
              onChange={(e) => setForm((p) => ({ ...p, meta_description: e.target.value }))}
            />

            {isEdit ? (
              <div className="full form-action-row">
                <button type="button" className="ghost form-back-btn" onClick={backToList}>
                  กลับ (ยังไม่บันทึก)
                </button>
                <button type="submit" className="primary form-save-btn" disabled={saving}>
                  {saving ? "กำลังบันทึก..." : "ยืนยันบันทึกการแก้ไข"}
                </button>
              </div>
            ) : (
              <button type="submit" className="primary full" disabled={saving}>
                {saving ? "กำลังบันทึก..." : "สร้าง"}
              </button>
            )}
          </form>
        </section>
      ) : null}

      {translateModalOpen ? (
        <div className="modal-backdrop" onClick={() => setTranslateModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-title-row">
              <h2>ตรวจสอบคำแปล</h2>
              <button type="button" className="ghost" onClick={() => setTranslateModalOpen(false)}>
                ปิด
              </button>
            </div>

            <div className="translate-grid">
              <div>
                <p className="muted">ไทย (ต้นฉบับ)</p>
                <input value={form.title} readOnly />
                <textarea rows={4} value={form.description} readOnly />
              </div>
              <div>
                <p className="muted">English</p>
                <input value={translated.en?.title || ""} readOnly />
                <textarea rows={4} value={translated.en?.description || ""} readOnly />
              </div>
              <div>
                <p className="muted">中文</p>
                <input value={translated.zh?.title || ""} readOnly />
                <textarea rows={4} value={translated.zh?.description || ""} readOnly />
              </div>
              <div>
                <p className="muted">ລາວ</p>
                <input value={translated.lo?.title || ""} readOnly />
                <textarea rows={4} value={translated.lo?.description || ""} readOnly />
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost" onClick={runTranslation} disabled={translating}>
                {translating ? "กำลังแปล..." : "แปลใหม่"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {insertImageModalOpen ? (
        <div className="modal-backdrop" onClick={() => setInsertImageModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-title-row">
              <h2>แทรกรูปภาพ</h2>
              <button type="button" className="ghost" onClick={() => setInsertImageModalOpen(false)}>
                ปิด
              </button>
            </div>

            <div className="grid">
              <input
                placeholder="วาง URL รูปภาพ"
                value={insertImageUrl}
                onChange={(e) => setInsertImageUrl(e.target.value)}
              />

              <input
                placeholder="คำอธิบายรูป (alt)"
                value={insertImageAlt}
                onChange={(e) => setInsertImageAlt(e.target.value)}
              />

              <label className="upload-btn inline-upload-btn">
                {uploadingInline ? "กำลังอัปโหลด..." : "อัปโหลดไฟล์รูปภาพ"}
                <input type="file" accept="image/*" onChange={onInlineFileChange} disabled={uploadingInline} />
              </label>

              <div className="content-toolbar">
                <button type="button" className="ghost" onClick={() => rotateInsertPreview(-90)}>
                  หมุนซ้าย 90°
                </button>
                <button type="button" className="ghost" onClick={() => rotateInsertPreview(90)}>
                  หมุนขวา 90°
                </button>
                <span className="muted">มุมหมุนปัจจุบัน: {insertImageRotation}°</span>
              </div>

              {insertImageUrl ? (
                <img
                  src={insertImageUrl}
                  alt="preview"
                  className="insert-preview"
                  style={{ transform: previewRotationTransform(insertImageRotation), transformOrigin: "center center" }}
                />
              ) : null}
            </div>

            <div className="modal-actions">
              <button type="button" className="primary" onClick={onInsertImageAtCursor}>
                แทรกรูป
              </button>
            </div>
          </div>
        </div>
      ) : null}


      {coverImageModalOpen ? (
        <div className="modal-backdrop" onClick={() => setCoverImageModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-title-row">
              <h2>ใส่รูปปก</h2>
              <button type="button" className="ghost" onClick={() => setCoverImageModalOpen(false)}>
                ปิด
              </button>
            </div>

            <div className="grid">
              <input
                placeholder="วาง URL รูปภาพปก"
                value={coverImageUrl}
                onChange={(e) => setCoverImageUrl(e.target.value)}
              />

              <label className="upload-btn inline-upload-btn">
                {uploadingCover ? "กำลังอัปโหลด..." : "อัปโหลดไฟล์รูปปก"}
                <input type="file" accept="image/*" onChange={onCoverModalFileChange} disabled={uploadingCover} />
              </label>

              <div className="content-toolbar">
                <button type="button" className="ghost" onClick={() => setCoverImageRotation((prev) => normalizeRotation(prev - 90))}>
                  หมุนซ้าย 90°
                </button>
                <button type="button" className="ghost" onClick={() => setCoverImageRotation((prev) => normalizeRotation(prev + 90))}>
                  หมุนขวา 90°
                </button>
                <span className="muted">มุมหมุนปัจจุบัน: {coverImageRotation}°</span>
              </div>

              {coverImageUrl ? (
                <img
                  src={coverImageUrl}
                  alt="cover-preview"
                  className="insert-preview"
                  style={{ transform: previewRotationTransform(coverImageRotation), transformOrigin: "center center" }}
                />
              ) : null}
            </div>

            <div className="modal-actions">
              <button type="button" className="primary" onClick={onApplyCoverImage}>
                ใช้เป็นรูปปก
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewWindowOpen ? (
        <div className="modal-backdrop" onClick={() => setPreviewWindowOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-title-row">
              <h2>รีวิวหน้าสุดท้าย (เหมือนหน้า frontend)</h2>
              <button type="button" className="ghost" onClick={() => setPreviewWindowOpen(false)}>
                ปิด
              </button>
            </div>

            <section className="space-y-4" style={{ maxWidth: 900, margin: "0 auto" }}>
              <p className="muted">{CATEGORY_LABEL[form.category]}</p>
              <h1 style={{ margin: 0, fontSize: "1.9rem", lineHeight: 1.2 }}>{form.title || "(ยังไม่ใส่ชื่อ)"}</h1>

              {previewCoverUrl ? (
                <div style={{ width: "min(50vw, 100%)", marginInline: "auto" }}>
                  <div style={{ overflow: "hidden", borderRadius: 14 }}>
                    <img
                      src={previewCoverUrl}
                      alt="cover-preview"
                      style={{
                        display: "block",
                        width: "100%",
                        height: "auto",
                        objectFit: "cover",
                        transform: previewRotationTransform(previewCoverRotation),
                        transformOrigin: "center center",
                      }}
                    />
                  </div>
                </div>
              ) : null}

              <article style={{ fontSize: 16, lineHeight: 1.9 }}>
                {previewContentBlocks.length === 0 ? (
                  <p className="muted">ยังไม่มีเนื้อหา</p>
                ) : (
                  previewContentBlocks.map((block, index) => {
                    if (block.type === "image") {
                      return (
                        <div key={`preview-block-img-${index}`} style={{ width: "min(50vw, 100%)", margin: "0 auto 1rem" }}>
                          <div style={{ overflow: "hidden", borderRadius: 12 }}>
                            <img
                              src={block.src}
                              alt={block.alt || "preview"}
                              style={{
                                display: "block",
                                width: "100%",
                                height: "auto",
                                objectFit: "cover",
                                transform: previewRotationTransform(block.rotation || 0),
                                transformOrigin: "center center",
                              }}
                            />
                          </div>
                        </div>
                      );
                    }

                    return (
                      <p key={`preview-block-text-${index}`} style={{ margin: "0 0 1rem", whiteSpace: "pre-line" }}>
                        {block.value}
                      </p>
                    );
                  })
                )}
              </article>
            </section>
          </div>
        </div>
      ) : null}
      {message ? <p className="status">{message}</p> : null}
    </>
  );
}


























































