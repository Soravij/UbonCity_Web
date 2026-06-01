import { useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../api/api";

const USAGE_TYPES = ["cover", "gallery", "inline"];

export default function MediaPickerModal({ token, onClose, onSelect, defaultUsageType = "cover" }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("approved");
  const [usageType, setUsageType] = useState(defaultUsageType);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setMessage("");
      try {
        const res = await api.get("/media-assets", {
          params: {
            status,
            q: query || undefined,
          },
          headers: authHeaders(token),
        });

        if (!active) return;
        setItems(Array.isArray(res.data?.items) ? res.data.items : []);
      } catch (err) {
        if (!active) return;
        setMessage(err?.response?.data?.error || err?.message || "Failed to load media assets");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [token, query, status]);

  const emptyLabel = useMemo(() => {
    if (loading) return "Loading...";
    return "No media assets found";
  }, [loading]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title-row">
          <h2>Media Library Picker</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="grid two" style={{ marginBottom: 12 }}>
          <input
            placeholder="Search title/url"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
            <option value="archived">Archived</option>
          </select>
          <select value={usageType} onChange={(e) => setUsageType(e.target.value)}>
            {USAGE_TYPES.map((it) => (
              <option key={it} value={it}>
                usage: {it}
              </option>
            ))}
          </select>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Preview</th>
                <th>Title</th>
                <th>Status</th>
                <th>Source</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>
                    {item.public_url ? (
                      <img
                        src={item.public_url}
                        alt={item.alt_text || item.title || "media"}
                        style={{ width: 88, height: 56, objectFit: "cover", borderRadius: 6 }}
                      />
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{item.title || item.file_name || "(untitled)"}</td>
                  <td>{item.status}</td>
                  <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.source_url || item.storage_path || "-"}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => onSelect?.(item, usageType)}
                    >
                      Use
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!items.length ? <p className="muted">{emptyLabel}</p> : null}
        {message ? <p className="status">{message}</p> : null}
      </div>
    </div>
  );
}
