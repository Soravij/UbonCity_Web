import { useCallback, useEffect, useMemo, useState } from "react";
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

function normalizeRotation(rotation) {
  const n = Number(rotation);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

function previewRotationTransform(rotation) {
  const rot = normalizeRotation(rotation);
  return `rotate(${rot}deg)`;
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
        alt: parsedAlt.alt || "รูปประกอบ",
        rotation: parsedAlt.rotation,
      });
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

function pendingTypeLabel(item) {
  return item.pending_type === "event" ? "Event" : "Places";
}

function pendingCategoryLabel(item) {
  if (item.pending_type === "event") return "Event";
  return CATEGORY_LABEL[item.category] || item.category || "-";
}

export default function Approvals({ token, onPendingChanged }) {
  const [filter, setFilter] = useState("all");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [approvingId, setApprovingId] = useState("");
  const [message, setMessage] = useState("");
  const [approvalLogs, setApprovalLogs] = useState([]);
  const [previewItem, setPreviewItem] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadPending = useCallback(async () => {
    setLoading(true);
    setMessage("");
    setApprovalLogs([]);

    try {
      const headers = authHeaders(token);

      const [placeResults, eventRes] = await Promise.all([
        Promise.all(
          CATEGORIES.map((c) =>
            api.get("/places", {
              params: { category: c, lang: "th", include_unapproved: 1 },
              headers,
            })
          )
        ),
        api.get("/events", {
          params: { include_unapproved: 1 },
          headers,
        }),
      ]);

      const placeItems = placeResults
        .flatMap((res) => (Array.isArray(res.data?.items) ? res.data.items : []))
        .filter((it) => !Number(it.is_approved))
        .map((it) => ({ ...it, pending_type: "place" }));

      const eventItems = (Array.isArray(eventRes.data?.items) ? eventRes.data.items : [])
        .filter((it) => !Number(it.is_approved))
        .map((it) => ({ ...it, pending_type: "event", category: "event" }));

      const merged = [...placeItems, ...eventItems].sort((a, b) => Number(b.id) - Number(a.id));
      setItems(merged);
      onPendingChanged?.(merged.length);
    } catch (err) {
      setMessage(err?.response?.data?.error || err?.message || "โหลดรายการรอตรวจสอบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [token, onPendingChanged]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "event") return items.filter((it) => it.pending_type === "event");
    return items.filter((it) => it.pending_type === "place" && it.category === filter);
  }, [items, filter]);

  const previewBlocks = useMemo(() => splitContentBlocks(previewItem?.description || ""), [previewItem?.description]);
  const previewFirstImageIndex = useMemo(() => previewBlocks.findIndex((b) => b.type === "image"), [previewBlocks]);
  const previewFirstImage = useMemo(
    () => (previewFirstImageIndex >= 0 ? previewBlocks[previewFirstImageIndex] : null),
    [previewBlocks, previewFirstImageIndex]
  );

  const parsedCover = useMemo(() => parseCoverImageValue(previewItem?.image), [previewItem?.image]);
  const previewCoverUrl = parsedCover.url || previewFirstImage?.src || "";
  const previewCoverRotation = parsedCover.url ? parsedCover.rotation : previewFirstImage?.rotation || 0;

  const previewContentBlocks = useMemo(() => {
    if (!parsedCover.url && previewFirstImageIndex >= 0) {
      return previewBlocks.filter((block, index) => !(block.type === "image" && index === previewFirstImageIndex));
    }
    return previewBlocks;
  }, [parsedCover.url, previewBlocks, previewFirstImageIndex]);

  async function onApprove(item) {
    const key = `${item.pending_type}-${item.id}`;
    setApprovingId(key);
    setMessage("");
    setApprovalLogs([]);

    try {
      if (item.pending_type === "event") {
        const res = await api.patch(`/events/${item.id}/approve`, {}, { headers: authHeaders(token) });
        const successMessage = `อนุมัติ Event ID ${item.id} แล้ว`;
        setMessage(successMessage);
        setNotice({ type: "success", text: successMessage });
        setApprovalLogs(Array.isArray(res?.data?.logs) ? res.data.logs : []);
      } else {
        const res = await api.patch(`/places/${item.id}/approve`, {}, { headers: authHeaders(token) });
        const successMessage = `อนุมัติเนื้อหา ID ${item.id} แล้ว`;
        setMessage(successMessage);
        setNotice({ type: "success", text: successMessage });
        setApprovalLogs(Array.isArray(res?.data?.logs) ? res.data.logs : []);
      }

      const next = items.filter((it) => !(it.pending_type === item.pending_type && it.id === item.id));
      setItems(next);
      onPendingChanged?.(next.length);
      if (previewItem?.id === item.id && previewItem?.pending_type === item.pending_type) {
        setPreviewItem(null);
      }
    } catch (err) {
      const errorMessage = err?.response?.data?.error || err?.message || "อนุมัติไม่สำเร็จ";
      setMessage(errorMessage);
      setNotice({ type: "error", text: `อนุมัติไม่สำเร็จ: ${errorMessage}` });
      setApprovalLogs(Array.isArray(err?.response?.data?.logs) ? err.response.data.logs : []);
    } finally {
      setApprovingId("");
    }
  }

  return (
    <>
      {notice ? (
        <div className="notice-backdrop" onClick={() => setNotice(null)}>
          <div className={`notice-card ${notice.type}`} onClick={(e) => e.stopPropagation()}>
            <div className="card-title-row">
              <h2>{notice.type === "success" ? "ดำเนินการสำเร็จ" : "เกิดข้อผิดพลาด"}</h2>
              <button type="button" className="ghost" onClick={() => setNotice(null)}>
                ปิด
              </button>
            </div>
            <p className="notice-text">{notice.text}</p>
          </div>
        </div>
      ) : null}

      <section className="admin-card">
        <div className="card-title-row">
          <h2>รอตรวจสอบ (Admin)</h2>
          <button type="button" className="ghost" onClick={loadPending} disabled={loading}>
            {loading ? "กำลังโหลด..." : "รีเฟรช"}
          </button>
        </div>

        <div className="grid two" style={{ marginBottom: 12 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">ทั้งหมด (Places + Event)</option>
            <option value="event">Event</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <input value={`จำนวนรอตรวจสอบ: ${filteredItems.length} รายการ`} readOnly />
        </div>

        {filteredItems.length === 0 ? (
          <p className="muted">ไม่มีรายการที่รอตรวจสอบ</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>ประเภท</th>
                  <th>หมวด</th>
                  <th>ชื่อ</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const key = `${item.pending_type}-${item.id}`;
                  return (
                    <tr key={key}>
                      <td>{item.id}</td>
                      <td>{pendingTypeLabel(item)}</td>
                      <td>{pendingCategoryLabel(item)}</td>
                      <td>{item.title}</td>
                      <td className="actions">
                        <button type="button" className="ghost" onClick={() => setPreviewItem(item)}>
                          Review
                        </button>
                        <button
                          type="button"
                          className="primary"
                          disabled={approvingId === key}
                          onClick={() => onApprove(item)}
                        >
                          {approvingId === key ? "กำลังอนุมัติ..." : "อนุมัติ"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {message ? <p className="status">{message}</p> : null}
      </section>

      {previewItem ? (
        <div className="modal-backdrop" onClick={() => setPreviewItem(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-title-row">
              <h2>
                Review ก่อนเผยแพร่ | {pendingTypeLabel(previewItem)} | ID: {previewItem.id}
              </h2>
              <button type="button" className="ghost" onClick={() => setPreviewItem(null)}>
                ปิด
              </button>
            </div>

            <section className="space-y-4" style={{ maxWidth: 900, margin: "0 auto" }}>
              <p className="muted">{pendingCategoryLabel(previewItem)}</p>
              <h1 style={{ margin: 0, fontSize: "1.9rem", lineHeight: 1.2 }}>
                {previewItem.title || "(ยังไม่ใส่ชื่อ)"}
              </h1>

              {previewCoverUrl ? (
                <div style={{ width: "min(50vw, 100%)", marginInline: "auto" }}>
                  <img
                    src={previewCoverUrl}
                    alt="cover-preview"
                    style={{
                      display: "block",
                      width: "100%",
                      height: "auto",
                      objectFit: "contain",
                      transform: previewRotationTransform(previewCoverRotation),
                      transformOrigin: "center center",
                    }}
                  />
                </div>
              ) : null}

              <article style={{ fontSize: 16, lineHeight: 1.8 }}>
                {previewContentBlocks.length === 0 ? (
                  <p className="muted">ยังไม่มีเนื้อหา</p>
                ) : (
                  previewContentBlocks.map((block, index) => {
                    if (block.type === "image") {
                      return (
                        <div key={`preview-block-img-${index}`} style={{ width: "min(50vw, 100%)", margin: "0 auto 0.75rem" }}>
                          <img
                            src={block.src}
                            alt={block.alt || "preview"}
                            style={{
                              display: "block",
                              width: "100%",
                              height: "auto",
                              objectFit: "contain",
                              transform: previewRotationTransform(block.rotation || 0),
                              transformOrigin: "center center",
                            }}
                          />
                        </div>
                      );
                    }

                    return (
                      <p key={`preview-block-text-${index}`} style={{ margin: "0 0 0.75rem", whiteSpace: "pre-line" }}>
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

      <section className="admin-card">
        <div className="card-title-row">
          <h2>Approval Logs</h2>
        </div>
        {approvalLogs.length ? (
          <pre
            style={{
              whiteSpace: "pre-wrap",
              margin: 0,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "#fffaf5",
              fontSize: 12,
              lineHeight: 1.55,
              maxHeight: 260,
              overflow: "auto",
            }}
          >
            {approvalLogs.map((line, idx) => `${idx + 1}. ${line}`).join("\n")}
          </pre>
        ) : (
          <p className="muted">ยังไม่มี log</p>
        )}
      </section>
    </>
  );
}





