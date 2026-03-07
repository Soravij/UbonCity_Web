import { useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../api/api";

const EMPTY = {
  title: "",
  description: "",
  image: "",
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

export default function Events({ token, role = "user" }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const isEditing = useMemo(() => editingId !== null, [editingId]);

  async function loadEvents() {
    setLoading(true);
    setMessage("");
    try {
      const res = await api.get("/events", {
        params: { include_unapproved: 1 },
        headers: authHeaders(token),
      });
      setItems(Array.isArray(res.data?.items) ? res.data.items : []);
    } catch (e) {
      setMessage(e?.response?.data?.error || e?.message || "โหลด Event ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvents();
  }, []);

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
      image: item.image || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY);
  }

  async function onSubmit(e) {
    e.preventDefault();

    if (!String(form.title || "").trim()) {
      setMessage("กรอกชื่อ Event ก่อนบันทึก");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const body = {
        title: String(form.title || "").trim(),
        description: String(form.description || "").trim(),
        image: String(form.image || "").trim(),
      };

      if (isEditing) {
        await api.put(`/events/${editingId}`, body, { headers: authHeaders(token) });
        setMessage(`อัปเดต Event ID ${editingId} แล้ว (รออนุมัติ)`);
      } else {
        await api.post("/events", body, { headers: authHeaders(token) });
        setMessage("สร้าง Event แล้ว (รออนุมัติ)");
      }

      resetForm();
      await loadEvents();
    } catch (e) {
      setMessage(e?.response?.data?.error || e?.message || "บันทึก Event ไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(item) {
    const ok = window.confirm(`ต้องการลบ Event ID ${item.id} ใช่หรือไม่?`);
    if (!ok) return;

    try {
      await api.delete(`/events/${item.id}`, { headers: authHeaders(token) });
      await deleteUploadedFile(item.image);
      setMessage(`ลบ Event ID ${item.id} สำเร็จ`);
      if (editingId === item.id) resetForm();
      await loadEvents();
    } catch (e) {
      setMessage(e?.response?.data?.error || e?.message || "ลบ Event ไม่สำเร็จ");
    }
  }

  return (
    <section className="admin-card">
      <div className="card-title-row">
        <h2>{isEditing ? `แก้ไข Event | ID: ${editingId}` : "จัดการ Event"}</h2>
        <button type="button" className="ghost" onClick={loadEvents} disabled={loading}>
          {loading ? "กำลังโหลด..." : "รีเฟรช"}
        </button>
      </div>

      <p className="muted" style={{ marginTop: -4 }}>
        Event ทุกรายการต้องรอ Admin อนุมัติก่อนเผยแพร่บนหน้าเว็บ (อนุมัติที่เมนู รอตรวจสอบ)
      </p>

      <form className="grid two" onSubmit={onSubmit}>
        <input
          className="full"
          placeholder="หัวข้อ Event"
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
          placeholder="ลิงก์รูปภาพ"
          value={form.image}
          onChange={(e) => setForm((prev) => ({ ...prev, image: e.target.value }))}
        />

        <label className="upload-btn inline-upload-btn">
          {uploading ? "กำลังอัปโหลด..." : "อัปโหลดรูป Event"}
          <input type="file" accept="image/*" onChange={onFileChange} disabled={uploading} />
        </label>

        {form.image ? (
          <div className="full" style={{ width: "min(320px, 100%)" }}>
            <img
              src={form.image}
              alt="event-preview"
              style={{ width: "100%", height: "auto", borderRadius: 10, border: "1px solid #e5e7eb" }}
            />
          </div>
        ) : null}

        <div className="full form-action-row">
          <button type="button" className="ghost form-back-btn" onClick={resetForm}>
            {isEditing ? "ยกเลิกแก้ไข" : "ล้างฟอร์ม"}
          </button>
          <button type="submit" className="primary form-save-btn" disabled={saving}>
            {saving ? "กำลังบันทึก..." : isEditing ? "ยืนยันบันทึก Event" : "สร้าง Event"}
          </button>
        </div>
      </form>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>หัวข้อ</th>
              <th>สถานะ</th>
              <th>เวลาอนุมัติ</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.title}</td>
                <td>{Number(item.is_approved) ? "อนุมัติแล้ว" : "รออนุมัติ"}</td>
                <td>{formatDateTime(item.approved_at)}</td>
                <td className="actions">
                  <button type="button" className="ghost" onClick={() => startEdit(item)}>
                    แก้ไข
                  </button>
                  {role === "admin" ? (
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
      {message ? <p className="status">{message}</p> : null}
    </section>
  );
}


