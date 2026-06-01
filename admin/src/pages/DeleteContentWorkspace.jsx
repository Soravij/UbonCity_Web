import { useCallback, useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../api/api";

const PLACE_CATEGORIES = ["attractions", "activities", "hotels", "cafes", "restaurants", "transport"];
const DELETE_CONTENT_TARGET_STORAGE_KEY = "delete_content_target";

function fmtDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("th-TH");
}

export default function DeleteContentWorkspace({ token, role }) {
  const [tab, setTab] = useState("places");
  const [placeCategory, setPlaceCategory] = useState("all");
  const [places, setPlaces] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [deletingKey, setDeletingKey] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [confirmNote, setConfirmNote] = useState("");
  const [target, setTarget] = useState(null);

  const ownerOnly = role === "owner";

  const loadPlaces = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const categories = placeCategory === "all" ? PLACE_CATEGORIES : [placeCategory];
      const requests = categories.flatMap((category) => ([
        api.get("/places", {
          params: { category, lang: "th", include_unapproved: 1, is_emer: 0 },
          headers: authHeaders(token),
        }),
        api.get("/places", {
          params: { category, lang: "th", include_unapproved: 1, is_emer: 1 },
          headers: authHeaders(token),
        }),
      ]));
      const responses = await Promise.all(requests);
      const merged = responses
        .flatMap((res) => (Array.isArray(res.data?.items) ? res.data.items : []))
        .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));
      setPlaces(merged);
    } catch (e) {
      setMessage(e?.response?.data?.error || e?.message || "Failed to load places");
    } finally {
      setLoading(false);
    }
  }, [placeCategory, token]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await api.get("/events", {
        params: { include_unapproved: 1 },
        headers: authHeaders(token),
      });
      setEvents(Array.isArray(res.data?.items) ? res.data.items : []);
    } catch (e) {
      setMessage(e?.response?.data?.error || e?.message || "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(DELETE_CONTENT_TARGET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      window.sessionStorage.removeItem(DELETE_CONTENT_TARGET_STORAGE_KEY);
      const nextTab = String(parsed?.entity_type || "").trim().toLowerCase() === "event" ? "events" : "places";
      setTab(nextTab);
      if (nextTab === "places" && parsed?.category) {
        setPlaceCategory(String(parsed.category).trim().toLowerCase());
      }
      const searchSeed = [parsed?.entity_id, parsed?.slug, parsed?.title].filter(Boolean).join(" ").trim();
      if (searchSeed) setSearch(searchSeed);
    } catch {
      // ignore malformed persisted conflict targets
    }
  }, []);

  useEffect(() => {
    if (tab === "places") {
      loadPlaces();
      return;
    }
    loadEvents();
  }, [tab, loadPlaces, loadEvents]);

  const rows = useMemo(() => {
    const source = tab === "places" ? places : events;
    const q = String(search || "").trim().toLowerCase();
    if (!q) return source;
    return source.filter((item) => {
      const haystack = [
        item?.id,
        item?.slug,
        item?.title,
        item?.category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [tab, places, events, search]);

  function askConfirm(item) {
    if (!ownerOnly) return;
    setTarget(item);
    setConfirmInput("");
    setConfirmNote("");
    setConfirmOpen(true);
  }

  async function runPurge() {
    if (!target?.id) return;
    const password = String(confirmInput || "").trim();
    if (!password) {
      setMessage("Owner password is required");
      return;
    }
    const purgeKey = `${target.kind}-${target.id}`;
    setDeletingKey(purgeKey);
    setMessage("");
    try {
      const endpoint = target.kind === "place" ? `/places/${target.id}` : `/events/${target.id}`;
      await api.delete(endpoint, {
        headers: authHeaders(token),
        data: { password, purge_note: String(confirmNote || "").trim() || null },
      });
      setConfirmOpen(false);
      setTarget(null);
      setMessage(`Purged ${target.kind} ID ${target.id}`);
      if (tab === "places") {
        await loadPlaces();
      } else {
        await loadEvents();
      }
    } catch (e) {
      setMessage(e?.response?.data?.error || e?.message || "Purge failed");
    } finally {
      setDeletingKey("");
    }
  }

  return (
    <section className="admin-card">
      <div className="card-title-row">
        <h2>Delete Content (Purge)</h2>
        <button
          type="button"
          className="ghost"
          onClick={() => (tab === "places" ? loadPlaces() : loadEvents())}
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
      <p className="muted">
        Owner-only destructive workspace. Purge removes content with relations/media cleanup and audit logging.
      </p>

      <div className="content-toolbar" style={{ marginTop: 12 }}>
        <button type="button" className={tab === "places" ? "primary" : "ghost"} onClick={() => setTab("places")}>
          Places
        </button>
        <button type="button" className={tab === "events" ? "primary" : "ghost"} onClick={() => setTab("events")}>
          Events
        </button>
      </div>

      {tab === "places" ? (
        <div className="grid two" style={{ marginTop: 12 }}>
          <select value={placeCategory} onChange={(e) => setPlaceCategory(e.target.value)}>
            <option value="all">all categories</option>
            {PLACE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input placeholder="Search by ID, slug, or title" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <input placeholder="Search by ID or title" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            {tab === "places" ? (
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Flow</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            ) : (
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Flow</th>
                <th>Approved At</th>
                <th>Action</th>
              </tr>
            )}
          </thead>
          <tbody>
            {rows.map((item) => {
              const key = `${tab === "places" ? "place" : "event"}-${item.id}`;
              return (
                <tr key={key}>
                  <td>{item.id}</td>
                  <td>{item.title || "-"}</td>
                  <td>
                    <span className={`content-channel-chip ${Number(item.is_emer) === 1 ? "emer" : "normal"}`}>
                      {Number(item.is_emer) === 1 ? "Emergency" : "Normal"}
                    </span>
                  </td>
                  <td>{tab === "places" ? (Number(item.is_approved) === 1 ? "Approved" : "Draft") : fmtDate(item.approved_at)}</td>
                  <td className="actions">
                    <button
                      type="button"
                      className="danger"
                      onClick={() => askConfirm({ id: item.id, kind: tab === "places" ? "place" : "event" })}
                      disabled={deletingKey === key}
                    >
                      {deletingKey === key ? "Purging..." : "Purge"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && rows.length === 0 ? <p className="muted">No content found</p> : null}
      {message ? <p className="status">{message}</p> : null}

      {confirmOpen ? (
        <div className="modal-backdrop" onClick={() => setConfirmOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-title-row">
              <h2>Confirm Purge</h2>
              <button type="button" className="ghost" onClick={() => setConfirmOpen(false)}>
                Close
              </button>
            </div>
            <p className="muted">
              Target: {target?.kind} #{target?.id}
            </p>
            <label>Password</label>
            <input
              type="password"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="Owner password"
            />
            <label>Note (optional)</label>
            <textarea rows={3} value={confirmNote} onChange={(e) => setConfirmNote(e.target.value)} placeholder="Reason for purge" />
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button type="button" className="danger" onClick={runPurge}>
                Confirm Purge
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
