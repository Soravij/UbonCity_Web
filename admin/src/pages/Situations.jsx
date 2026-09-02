import { useEffect, useState } from "react";
import { api, authHeaders } from "../api/api";

const LANGS = [
  { code: "en", label: "English" },
  { code: "th", label: "ไทย" },
  { code: "zh", label: "中文" },
  { code: "lo", label: "ລາວ" },
];

const EMPTY_TRANSLATIONS = {
  en: { title: "", description: "" },
  th: { title: "", description: "" },
  zh: { title: "", description: "" },
  lo: { title: "", description: "" },
};

function emptyForm() {
  return {
    slug: "",
    sort_order: 0,
    is_active: 1,
    image_url: "",
    translations: JSON.parse(JSON.stringify(EMPTY_TRANSLATIONS)),
  };
}

export default function Situations({ token }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  async function loadList() {
    setLoading(true);
    try {
      const res = await api.get("/situations");
      setList(res.data?.items || []);
    } catch {
      setMessage("โหลดรายการไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadList();
  }, []);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateTranslation(lang, field, value) {
    setForm((prev) => ({
      ...prev,
      translations: {
        ...prev.translations,
        [lang]: { ...prev.translations[lang], [field]: value },
      },
    }));
  }

  async function handleEdit(slug) {
    try {
      const res = await api.get(`/situations/${slug}`);
      const item = res.data?.item;
      if (!item) return;

      const translations = JSON.parse(JSON.stringify(EMPTY_TRANSLATIONS));
      for (const t of item.translations || []) {
        if (translations[t.lang]) {
          translations[t.lang] = {
            title: t.title || "",
            description: t.description || "",
          };
        }
      }

      setForm({
        slug: item.slug,
        sort_order: item.sort_order ?? 0,
        is_active: item.is_active ?? 1,
        image_url: item.image_url || "",
        translations,
      });
      setEditing(item.slug);
      setMessage("");
    } catch {
      setMessage("โหลดข้อมูลไม่สำเร็จ");
    }
  }

  async function handleDelete(slug) {
    if (!window.confirm("ลบ situation นี้?")) return;
    try {
      await api.delete(`/situations/${slug}`, { headers: authHeaders(token) });
      setMessage("ลบสำเร็จ");
      loadList();
    } catch {
      setMessage("ลบไม่สำเร็จ");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const translations = {};
    for (const lang of LANGS) {
      const entry = form.translations[lang.code];
      translations[lang.code] = {
        title: entry?.title?.trim() ?? "",
        description: entry?.description?.trim() ?? "",
      };
    }

    const body = {
      slug: form.slug,
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active ? 1 : 0,
      image_url: form.image_url.trim() || null,
      translations,
    };

    try {
      const headers = { ...authHeaders(token), "Content-Type": "application/json" };
      if (editing) {
        await api.put(`/situations/${editing}`, body, { headers });
        setMessage("อัปเดตสำเร็จ");
      } else {
        await api.post("/situations", body, { headers });
        setMessage("สร้างสำเร็จ");
      }
      setForm(emptyForm());
      setEditing(null);
      loadList();
    } catch (err) {
      setMessage(err.response?.data?.error || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setForm(emptyForm());
    setEditing(null);
    setMessage("");
  }

  return (
    <div>
      <h2>Situations</h2>

      <div className="admin-card">
        <h3>รายการสถานการณ์</h3>
        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ลำดับ</th>
                <th>Slug</th>
                <th>ชื่อ</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) => (
                <tr key={item.id}>
                  <td>{item.sort_order}</td>
                  <td>{item.slug}</td>
                  <td>{item.title}</td>
                  <td>{item.is_active ? "เปิด" : "ปิด"}</td>
                  <td>
                    <button type="button" className="ghost" onClick={() => handleEdit(item.slug)}>
                      แก้ไข
                    </button>{" "}
                    <button type="button" className="danger" onClick={() => handleDelete(item.slug)}>
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr>
                  <td colSpan={5} className="muted">ยังไม่มีรายการ</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-card">
        <h3>{editing ? "แก้ไข situation" : "เพิ่ม situation ใหม่"}</h3>

        {message ? <p className="status">{message}</p> : null}

        <form onSubmit={handleSubmit}>
          <label>
            Slug
            <input
              type="text"
              value={form.slug}
              onChange={(e) => updateField("slug", e.target.value)}
              disabled={Boolean(editing)}
              required
            />
          </label>

          <label>
            ลำดับ (sort_order)
            <input
              type="number"
              value={form.sort_order}
              onChange={(e) => updateField("sort_order", e.target.value)}
            />
          </label>

          <label>
            <input
              type="checkbox"
              checked={Boolean(form.is_active)}
              onChange={(e) => updateField("is_active", e.target.checked ? 1 : 0)}
            />{" "}
            เปิดใช้งาน
          </label>

          <label>
            Image URL
            <input
              type="text"
              value={form.image_url}
              onChange={(e) => updateField("image_url", e.target.value)}
              placeholder="https://..."
            />
          </label>

          {LANGS.map((lang) => (
            <fieldset key={lang.code}>
              <legend>
                {lang.label}
                {lang.code === "en" ? " (จำเป็น)" : ""}
              </legend>
              <label>
                Title
                <input
                  type="text"
                  value={form.translations[lang.code].title}
                  onChange={(e) => updateTranslation(lang.code, "title", e.target.value)}
                  required={lang.code === "en"}
                />
              </label>
              <label>
                Description
                <textarea
                  value={form.translations[lang.code].description}
                  onChange={(e) => updateTranslation(lang.code, "description", e.target.value)}
                  rows={2}
                />
              </label>
            </fieldset>
          ))}

          <p className="muted">ภาษาที่เว้นว่างจะแสดงเป็นภาษาอังกฤษแทน</p>

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button
              type="submit"
              className="primary"
              disabled={saving || !form.translations.en.title.trim()}
            >
              {saving ? "กำลังบันทึก..." : editing ? "อัปเดต" : "สร้าง"}
            </button>
            <button type="button" className="ghost" onClick={handleCancel}>
              ยกเลิก
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
