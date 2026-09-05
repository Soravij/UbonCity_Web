import { useEffect, useState } from "react";
import { api, authHeaders } from "../api/api";

function slugFromEnTitle(value) {
  const base = String(value || "").normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || `situation-${Date.now()}`;
}

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
    translations: JSON.parse(JSON.stringify(EMPTY_TRANSLATIONS)),
  };
}

export default function Situations({ token }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [expandedSlug, setExpandedSlug] = useState(null);
  const [drawerPlaces, setDrawerPlaces] = useState({});
  const [drawerPlacesLoading, setDrawerPlacesLoading] = useState(false);

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

  async function toggleRow(slug) {
    if (expandedSlug === slug) {
      setExpandedSlug(null);
      return;
    }
    setExpandedSlug(slug);
    loadDrawerPlaces(slug);
  }

  async function loadDrawerPlaces(slug) {
    setDrawerPlacesLoading(true);
    try {
      const res = await api.get(`/situations/${slug}/places`);
      setDrawerPlaces((prev) => ({ ...prev, [slug]: res.data?.items || [] }));
    } catch {
      setDrawerPlaces((prev) => ({ ...prev, [slug]: [] }));
    } finally {
      setDrawerPlacesLoading(false);
    }
  }

  async function handleEdit(slug) {
    try {
      const res = await api.get(`/situations/${slug}`);
      const item = res.data?.item;
      if (!item) return;
      const translations = JSON.parse(JSON.stringify(EMPTY_TRANSLATIONS));
      for (const t of item.translations || []) {
        if (translations[t.lang]) {
          translations[t.lang] = { title: t.title || "", description: t.description || "" };
        }
      }
      setForm({ translations });
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
      translations,
    };

    try {
      const headers = { ...authHeaders(token), "Content-Type": "application/json" };
      if (editing) {
        await api.put(`/situations/${editing}`, body, { headers });
        setMessage("อัปเดตสำเร็จ");
      } else {
        await api.post("/situations", { ...body, slug: slugFromEnTitle(form.translations.en?.title) }, { headers });
        setMessage("สร้างสำเร็จ");
      }
      setForm(emptyForm());
      setEditing(null);
      loadList();
    } catch (err) {
      const serverError = err.response?.data?.error;
      setMessage(serverError || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setForm(emptyForm());
    setEditing(null);
    setMessage("");
  }

  async function handleReorder(slug, direction) {
    try {
      await api.post("/situations/reorder", { slug, direction }, { headers: authHeaders(token) });
      loadList();
    } catch {
      setMessage("สลับลำดับไม่สำเร็จ");
    }
  }

  async function handlePlaceReorder(slug, placeId, direction) {
    try {
      await api.post(`/situations/${slug}/places/reorder`, { place_id: placeId, direction }, { headers: authHeaders(token) });
      loadDrawerPlaces(slug);
    } catch {
      setMessage("สลับลำดับ place ไม่สำเร็จ");
    }
  }

  async function handlePlaceDelete(slug, placeId) {
    if (!window.confirm("ลบ place ออกจาก situation นี้?")) return;
    try {
      await api.delete(`/situations/${slug}/places/${placeId}`, { headers: authHeaders(token) });
      loadDrawerPlaces(slug);
    } catch {
      setMessage("ลบ place ไม่สำเร็จ");
    }
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
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {list.map((item, idx) => (
                <>
                  <tr
                    key={item.id}
                    onClick={() => toggleRow(item.slug)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>{item.sort_order}</td>
                    <td>{item.slug}</td>
                    <td>{item.title}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="ghost" onClick={() => handleEdit(item.slug)}>
                        แก้ไข
                      </button>{" "}
                      <button type="button" className="danger" onClick={() => handleDelete(item.slug)}>
                        ลบ
                      </button>{" "}
                      {idx > 0 ? (
                        <button type="button" className="ghost" onClick={() => handleReorder(item.slug, "up")}>
                          ↑
                        </button>
                      ) : null}{" "}
                      {idx < list.length - 1 ? (
                        <button type="button" className="ghost" onClick={() => handleReorder(item.slug, "down")}>
                          ↓
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {expandedSlug === item.slug ? (
                    <tr key={`${item.id}-drawer`}>
                      <td colSpan={4}>
                        <h4 style={{ marginBottom: "0.5rem" }}>Places ใน situation นี้</h4>
                        {drawerPlacesLoading ? (
                          <p className="muted">กำลังโหลด places...</p>
                        ) : !(drawerPlaces[expandedSlug]?.length) ? (
                          <p className="muted">ยังไม่มีรายการ</p>
                        ) : (
                          <table>
                              <thead>
                                <tr>
                                  <th>ลำดับ</th>
                                  <th>ชื่อ</th>
                                  <th>หมวด</th>
                                  <th>จัดการ</th>
                                </tr>
                              </thead>
                              <tbody>
                                {drawerPlaces[expandedSlug].map((p, pIdx) => {
                                  const quota = item.sort_order === 1 ? 5 : 3;
                                  const overQuota = pIdx >= quota;
                                  const borderTd = overQuota ? { borderTop: "1px solid var(--theme-danger)" } : undefined;
                                  const nameTd = overQuota
                                    ? { borderTop: "1px solid var(--theme-danger)", maxWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
                                    : { maxWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
                                  return (
                                    <tr
                                      key={p.id}
                                      style={overQuota ? { opacity: 0.55 } : undefined}
                                    >
                                      <td style={borderTd}>{p.sort_order}</td>
                                      <td style={nameTd} title={p.title}>{p.title}</td>
                                      <td style={borderTd}>{p.category}</td>
                                      <td style={borderTd}>
                                        {pIdx > 0 ? (
                                          <button type="button" className="ghost" onClick={() => handlePlaceReorder(expandedSlug, p.id, "up")}>
                                            ↑
                                          </button>
                                        ) : null}{" "}
                                        {pIdx < drawerPlaces[expandedSlug].length - 1 ? (
                                          <button type="button" className="ghost" onClick={() => handlePlaceReorder(expandedSlug, p.id, "down")}>
                                            ↓
                                          </button>
                                        ) : null}{" "}
                                        <button type="button" className="danger" onClick={() => handlePlaceDelete(expandedSlug, p.id)}>
                                          ลบ
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                      </td>
                    </tr>
                  ) : null}
                </>
              ))}
              {!list.length && (
                <tr>
                  <td colSpan={4} className="muted">ยังไม่มีรายการ</td>
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
            {message ? <p className="status">{message}</p> : null}
          </div>
        </form>
      </div>
    </div>
  );
}
