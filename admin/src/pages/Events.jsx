import { useCallback, useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../api/api";
import MediaPickerModal from "../components/MediaPickerModal";

const EMPTY = {
  title: "",
  description: "",
  meta_title: "",
  meta_description: "",
  image: "",
  decision_featured_score: "",
  decision_scenario_tags: "",
  decision_trend_flags: "",
  decision_moment_tags: "",
  decision_insight_flags: "",
  decision_cover_image: "",
  decision_thumbnail_image: "",
};

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
    img.onerror = () => reject(new Error("โหลดภาพไม่สำเร็จ"));
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

function isManagedUploadUrl(url) {
  const value = String(url || "").trim();
  return /\/uploads\//i.test(value);
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("th-TH");
}

export default function Events({ token, role = "user", channel = "normal" }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [pendingMediaUsages, setPendingMediaUsages] = useState([]);
  const [message, setMessage] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState(null);
  const [purgePassword, setPurgePassword] = useState("");
  const [purgeNote, setPurgeNote] = useState("");

  const isEditing = useMemo(() => editingId !== null, [editingId]);
  const isEmerChannel = String(channel || "").trim().toLowerCase() === "emer";

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await api.get("/events", {
        params: { include_unapproved: 1, is_emer: isEmerChannel ? 1 : 0 },
        headers: authHeaders(token),
      });
      setItems(Array.isArray(res.data?.items) ? res.data.items : []);
    } catch (e) {
      setMessage(e?.response?.data?.error || e?.message || "โหลด Event ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [isEmerChannel, token]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

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

  async function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const url = await uploadImageFile(file);
      setForm((prev) => ({ ...prev, image: url }));
    } catch (err) {
      setMessage(err?.response?.data?.error || err?.message || "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
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

  function startEdit(item) {
    setEditingId(item.id);
    setForm({
      title: item.title || "",
      description: item.description || "",
      meta_title: item.meta_title || "",
      meta_description: item.meta_description || "",
      image: item.image || "",
      decision_featured_score: item.decision_featured_score ?? "",
      decision_scenario_tags: item.decision_scenario_tags || "",
      decision_trend_flags: item.decision_trend_flags || "",
      decision_moment_tags: item.decision_moment_tags || "",
      decision_insight_flags: item.decision_insight_flags || "",
      decision_cover_image: item.decision_cover_image || "",
      decision_thumbnail_image: item.decision_thumbnail_image || "",
    });
    setPendingMediaUsages([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setEditingId(null);
    setPendingMediaUsages([]);
    setForm(EMPTY);
  }

  async function attachPendingUsages(eventId) {
    if (!eventId || !pendingMediaUsages.length) return;

    for (let i = 0; i < pendingMediaUsages.length; i += 1) {
      const usage = pendingMediaUsages[i];
      await api.post(
        "/media-usages",
        {
          asset_id: usage.asset_id,
          entity_type: "event",
          entity_id: Number(eventId),
          usage_type: usage.usage_type,
          position: i,
          apply_legacy_cover: usage.usage_type === "cover",
        },
        { headers: authHeaders(token) }
      );
    }
  }

  async function onSubmit(e) {
    e.preventDefault();

    if (!String(form.title || "").trim()) {
      setMessage("กรุณาระบุชื่อ Event");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const body = {
        is_emer: isEmerChannel ? 1 : 0,
        title: String(form.title || "").trim(),
        description: String(form.description || "").trim(),
        meta_title: String(form.meta_title || "").trim(),
        meta_description: String(form.meta_description || "").trim(),
        image: String(form.image || "").trim(),
        decision_featured_score:
          form.decision_featured_score === "" ? null : Number(form.decision_featured_score),
        decision_scenario_tags: String(form.decision_scenario_tags || "").trim(),
        decision_trend_flags: String(form.decision_trend_flags || "").trim(),
        decision_moment_tags: String(form.decision_moment_tags || "").trim(),
        decision_insight_flags: String(form.decision_insight_flags || "").trim(),
        decision_cover_image: String(form.decision_cover_image || "").trim(),
        decision_thumbnail_image: String(form.decision_thumbnail_image || "").trim(),
      };

      if (isEditing) {
        await api.put(`/events/${editingId}`, body, { headers: authHeaders(token) });
        await attachPendingUsages(editingId);
        setMessage(
          isEmerChannel
            ? `อัปเดต Event ID ${editingId} แล้ว`
            : `อัปเดต Event ID ${editingId} แล้ว (รายการจะกลับไป pending approval)`
        );
      } else {
        const created = await api.post("/events", body, { headers: authHeaders(token) });
        const createdId = Number(created?.data?.id || created?.data?.event_id || 0);
        await attachPendingUsages(createdId);
        setMessage(
          isEmerChannel
            ? "สร้าง Event แล้ว"
            : "สร้าง Event แล้ว (รายการจะกลับไป pending approval)"
        );
      }

      resetForm();
      await loadEvents();
    } catch (e) {
      const emerConflict = e?.response?.data?.error === "emer_conflict" ? e?.response?.data?.conflict : null;
      const conflictHint = emerConflict
        ? `Emergency content exists (#${emerConflict.entity_id}${emerConflict.slug ? `, slug: ${emerConflict.slug}` : ""}). Purge it first.`
        : "";
      setMessage(conflictHint || e?.response?.data?.error || e?.message || "Save event failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(item) {
    const ok = window.confirm(`Confirm purge event ID ${item.id}?`);
    if (!ok) return;
    setPurgeTarget(item);
    setPurgePassword("");
    setPurgeNote("");
    setPurgeModalOpen(true);
  }

  async function confirmPurgeEvent() {
    const item = purgeTarget;
    if (!item?.id) return;
    const normalizedPassword = String(purgePassword || "").trim();
    if (!normalizedPassword) {
      setMessage("Owner password is required");
      return;
    }

    setDeletingId(item.id);
    try {
      await api.delete(`/events/${item.id}`, {
        headers: authHeaders(token),
        data: { password: normalizedPassword, purge_note: String(purgeNote || "").trim() || null },
      });
      setMessage(`Purged event ID ${item.id}`);
      setPurgeModalOpen(false);
      setPurgeTarget(null);
      if (editingId === item.id) resetForm();
      await loadEvents();
    } catch (e) {
      setMessage(e?.response?.data?.error || e?.message || "Purge event failed");
    } finally {
      setDeletingId(null);
    }
  }

  function onSelectFromMediaLibrary(asset, usageType) {
    const nextUsage = {
      asset_id: Number(asset?.id || 0),
      usage_type: usageType || "cover",
      public_url: String(asset?.public_url || "").trim(),
    };

    if (!nextUsage.asset_id || !nextUsage.public_url) {
      setMessage("ยังเลือก asset ที่ใช้ไม่ได้");
      return;
    }

    if (nextUsage.usage_type === "cover") {
      setForm((prev) => ({ ...prev, image: nextUsage.public_url }));
      setPendingMediaUsages((prev) => [...prev.filter((x) => x.usage_type !== "cover"), nextUsage]);
      setMediaPickerOpen(false);
      return;
    }

    if (nextUsage.usage_type === "inline") {
      setForm((prev) => ({
        ...prev,
        description: `${String(prev.description || "").trim()}\n\n![Media image](${nextUsage.public_url})`,
      }));
      setPendingMediaUsages((prev) => [...prev, nextUsage]);
      setMediaPickerOpen(false);
      return;
    }

    setPendingMediaUsages((prev) => [...prev, nextUsage]);
    setMessage(`เพิ่ม usage ประเภท ${nextUsage.usage_type} แล้ว`);
    setMediaPickerOpen(false);
  }

  return (
    <section className="admin-card">
      <div className="card-title-row">
        <h2>{isEditing ? `แก้ไข Event | ID: ${editingId}` : "สร้าง Event"}</h2>
        <button type="button" className="ghost" onClick={loadEvents} disabled={loading}>
          {loading ? "กำลังโหลด..." : "รีเฟรช"}
        </button>
      </div>

      <p className="muted" style={{ marginTop: -4 }}>
        {isEmerChannel
          ? "Emergency Event ที่สร้างจาก owner tool จะเผยแพร่ขึ้น frontend ได้ทันที"
          : "Event จะถูกสร้างหรือแก้ไขจากฝั่ง admin และต้องผ่าน approval ก่อนจึงจะใช้งานบน public หรือ homepage ได้"}
      </p>

      <form className="grid two" onSubmit={onSubmit}>
        <input
          className="full"
          placeholder="ชื่อ Event"
          value={form.title}
          onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
          required
        />

        <textarea
          className="full"
          rows={4}
          placeholder="รายละเอียด"
          value={form.description}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
        />

        <input
          placeholder="Meta title (SEO)"
          value={form.meta_title}
          onChange={(e) => setForm((prev) => ({ ...prev, meta_title: e.target.value }))}
        />

        <input
          placeholder="Meta description (SEO)"
          value={form.meta_description}
          onChange={(e) => setForm((prev) => ({ ...prev, meta_description: e.target.value }))}
        />

        <input
          placeholder="ลิงก์รูปหลัก"
          value={form.image}
          onChange={(e) => setForm((prev) => ({ ...prev, image: e.target.value }))}
        />

        <label className="upload-btn inline-upload-btn">
          {uploading ? "กำลังอัปโหลด..." : "อัปโหลดรูป Event"}
          <input type="file" accept="image/*" onChange={onFileChange} disabled={uploading} />
        </label>

        <button type="button" className="ghost" onClick={() => setMediaPickerOpen(true)}>
          เลือกจากคลังมีเดีย
        </button>

        <div className="full content-toolbar">
          <span className="muted">Decision Metadata (Public)</span>
        </div>

        <input
          type="number"
          min={0}
          max={1000}
          placeholder="Featured score (0-1000)"
          value={form.decision_featured_score}
          onChange={(e) => setForm((prev) => ({ ...prev, decision_featured_score: e.target.value }))}
        />

        <input
          placeholder="Scenario tags (comma separated)"
          value={form.decision_scenario_tags}
          onChange={(e) => setForm((prev) => ({ ...prev, decision_scenario_tags: e.target.value }))}
        />

        <input
          className="full"
          placeholder="Trend flags (comma separated)"
          value={form.decision_trend_flags}
          onChange={(e) => setForm((prev) => ({ ...prev, decision_trend_flags: e.target.value }))}
        />

        <input
          className="full"
          placeholder="Moment tags (comma separated)"
          value={form.decision_moment_tags}
          onChange={(e) => setForm((prev) => ({ ...prev, decision_moment_tags: e.target.value }))}
        />

        <input
          className="full"
          placeholder="Insight flags (comma separated)"
          value={form.decision_insight_flags}
          onChange={(e) => setForm((prev) => ({ ...prev, decision_insight_flags: e.target.value }))}
        />

        <input
          className="full"
          placeholder="Decision cover image URL (optional)"
          value={form.decision_cover_image}
          onChange={(e) => setForm((prev) => ({ ...prev, decision_cover_image: e.target.value }))}
        />

        <input
          className="full"
          placeholder="Decision thumbnail image URL (optional)"
          value={form.decision_thumbnail_image}
          onChange={(e) => setForm((prev) => ({ ...prev, decision_thumbnail_image: e.target.value }))}
        />

        {form.image ? (
          <div className="full" style={{ width: "min(320px, 100%)" }}>
            <img
              src={form.image}
              alt="event-preview"
              className="event-preview-image"
              style={{ width: "100%", height: "auto", borderRadius: 10 }}
            />
          </div>
        ) : null}

        <div className="full form-action-row">
          <button type="button" className="ghost form-back-btn" onClick={resetForm}>
            {isEditing ? "ยกเลิกการแก้ไข" : "ล้างฟอร์ม"}
          </button>
          <button type="submit" className="primary form-save-btn" disabled={saving}>
            {saving ? "กำลังบันทึก..." : isEditing ? "บันทึกการแก้ไข Event" : "สร้าง Event"}
          </button>
        </div>
      </form>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Flow</th>
              <th>ชื่อ</th>
              <th>สถานะ</th>
              <th>อนุมัติเมื่อ</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>
                  <span className={`content-channel-chip ${Number(item.is_emer) === 1 ? "emer" : "normal"}`}>
                    {Number(item.is_emer) === 1 ? "Emergency" : "Normal"}
                  </span>
                </td>
                <td>{item.title}</td>
                <td>{Number(item.is_approved) ? "Approved" : "Pending"}</td>
                <td>{formatDateTime(item.approved_at)}</td>
                <td className="actions">
                  <button type="button" className="ghost" onClick={() => startEdit(item)}>
                    แก้ไข
                  </button>
                  {role === "owner" ? (
                    <button type="button" className="danger" onClick={() => onDelete(item)}>
                      ลบ
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && items.length === 0 ? <p className="muted">ยังไม่มี Event</p> : null}
      {pendingMediaUsages.length ? (
        <p className="muted">มี usage media รอผูกกับ Event {pendingMediaUsages.length} รายการ</p>
      ) : null}
      {purgeModalOpen ? (
        <div className="modal-backdrop" onClick={() => setPurgeModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-title-row">
              <h2>Purge Event</h2>
              <button type="button" className="ghost" onClick={() => setPurgeModalOpen(false)}>Close</button>
            </div>
            <p className="muted">Target ID: {purgeTarget?.id || "-"}</p>
            <label>Password</label>
            <input type="password" value={purgePassword} onChange={(e) => setPurgePassword(e.target.value)} placeholder="Owner password" />
            <label>Note (optional)</label>
            <textarea rows={3} value={purgeNote} onChange={(e) => setPurgeNote(e.target.value)} placeholder="Reason for purge" />
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setPurgeModalOpen(false)}>Cancel</button>
              <button type="button" className="danger" onClick={confirmPurgeEvent} disabled={deletingId === purgeTarget?.id}>
                {deletingId === purgeTarget?.id ? "Purging..." : "Confirm Purge"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {message ? <p className="status">{message}</p> : null}

      {mediaPickerOpen ? (
        <MediaPickerModal
          token={token}
          defaultUsageType="cover"
          onClose={() => setMediaPickerOpen(false)}
          onSelect={onSelectFromMediaLibrary}
        />
      ) : null}
    </section>
  );
}



