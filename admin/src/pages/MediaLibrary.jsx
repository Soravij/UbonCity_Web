import { useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../api/api";

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function extractBase64(dataUrl) {
  const value = String(dataUrl || "");
  return value.includes(",") ? value.split(",")[1] : value;
}

export default function MediaLibrary({ token, role = "user" }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("pending");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [registerUrl, setRegisterUrl] = useState("");

  const isOwner = useMemo(() => role === "owner", [role]);

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
      setItems(Array.isArray(res.data?.items) ? res.data.items : []);
    } catch (err) {
      setMessage(err?.response?.data?.error || err?.message || "Failed to load media assets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [status]);

  async function onUploadFile(file) {
    if (!file) return;

    try {
      setUploading(true);
      const dataUrl = await readFileAsDataUrl(file);
      const base64 = extractBase64(dataUrl);

      await api.post(
        "/media-assets/upload",
        {
          dataBase64: base64,
          mimeType: String(file.type || "application/octet-stream"),
          title: String(file.name || "").trim() || null,
          alt_text: "",
          source_url: "",
          related_type: "other",
        },
        { headers: authHeaders(token) }
      );

      setMessage("Uploaded to media library (pending)");
      await load();
    } catch (err) {
      setMessage(err?.response?.data?.error || err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onRegisterUrl() {
    if (!registerUrl.trim()) {
      setMessage("Please input source url");
      return;
    }

    try {
      await api.post(
        "/media-assets/register",
        {
          source_url: registerUrl.trim(),
          storage_disk: "external",
          related_type: "other",
        },
        { headers: authHeaders(token) }
      );
      setRegisterUrl("");
      setMessage("Registered source url as raw media asset");
      await load();
    } catch (err) {
      setMessage(err?.response?.data?.error || err?.message || "Register failed");
    }
  }

  async function saveEdit() {
    if (!editing?.id) return;

    try {
      await api.patch(
        `/media-assets/${editing.id}`,
        {
          title: editing.title || "",
          alt_text: editing.alt_text || "",
          credit: editing.credit || "",
          notes: editing.notes || "",
          status: editing.status || "pending",
        },
        { headers: authHeaders(token) }
      );
      setEditing(null);
      setMessage("Media metadata updated");
      await load();
    } catch (err) {
      setMessage(err?.response?.data?.error || err?.message || "Update failed");
    }
  }

  async function quickReview(item, statusValue) {
    if (!isOwner) return;

    try {
      await api.patch(
        `/media-assets/${item.id}`,
        { status: statusValue },
        { headers: authHeaders(token) }
      );
      setMessage(`Asset #${item.id} marked as ${statusValue}`);
      await load();
    } catch (err) {
      setMessage(err?.response?.data?.error || err?.message || "Review failed");
    }
  }

  async function onDelete(item) {
    if (!isOwner) return;
    const ok = window.confirm(`Delete media asset ${item.id}?`);
    if (!ok) return;

    try {
      await api.delete(`/media-assets/${item.id}`, { headers: authHeaders(token) });
      setMessage(`Deleted asset ${item.id}`);
      await load();
    } catch (err) {
      setMessage(err?.response?.data?.error || err?.message || "Delete failed");
    }
  }

  return (
    <section className="admin-card" style={{ marginTop: 0 }}>
      <div className="card-title-row">
        <h2>Media Library</h2>
        <button type="button" className="ghost" onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="grid two" style={{ marginBottom: 12 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">pending</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
          <option value="archived">archived</option>
        </select>
        <input placeholder="Search and click Refresh" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {isOwner ? (
        <div className="grid two" style={{ marginBottom: 12 }}>
          <label className="upload-btn inline-upload-btn">
            {uploading ? "Uploading..." : "Upload Image to Library"}
            <input type="file" accept="image/*" onChange={(e) => onUploadFile(e.target.files?.[0])} disabled={uploading} />
          </label>

          <div className="content-toolbar">
            <input
              placeholder="Register external source URL"
              value={registerUrl}
              onChange={(e) => setRegisterUrl(e.target.value)}
            />
            <button type="button" className="ghost" onClick={onRegisterUrl}>
              Register URL
            </button>
          </div>
        </div>
      ) : (
        <p className="muted" style={{ marginBottom: 12 }}>
          Media library is read-only for non-owner accounts.
        </p>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Preview</th>
              <th>Title</th>
              <th>Status</th>
              <th>Source</th>
              <th>Usage</th>
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
                      style={{ width: 96, height: 56, objectFit: "cover", borderRadius: 6 }}
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
                <td>{item.usage_count || 0}</td>
                <td className="actions">
                  {isOwner ? (
                    <>
                      <button type="button" className="ghost" onClick={() => setEditing(item)}>
                        Edit
                      </button>
                      <button type="button" className="ghost" onClick={() => quickReview(item, "approved")}>
                        Approve
                      </button>
                      <button type="button" className="ghost" onClick={() => quickReview(item, "rejected")}>
                        Reject
                      </button>
                      <button type="button" className="danger" onClick={() => onDelete(item)}>
                        Delete
                      </button>
                    </>
                  ) : (
                    <span className="muted">Read-only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-title-row">
              <h2>Edit Media #{editing.id}</h2>
              <button type="button" className="ghost" onClick={() => setEditing(null)}>
                Close
              </button>
            </div>

            <div className="grid">
              <input value={editing.title || ""} onChange={(e) => setEditing((p) => ({ ...p, title: e.target.value }))} placeholder="title" />
              <input value={editing.alt_text || ""} onChange={(e) => setEditing((p) => ({ ...p, alt_text: e.target.value }))} placeholder="alt text" />
              <input value={editing.credit || ""} onChange={(e) => setEditing((p) => ({ ...p, credit: e.target.value }))} placeholder="credit" />
              <textarea rows={3} value={editing.notes || ""} onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))} placeholder="notes" />
              <select value={editing.status || "pending"} onChange={(e) => setEditing((p) => ({ ...p, status: e.target.value }))}>
                <option value="pending">pending</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
                <option value="archived">archived</option>
              </select>
            </div>

            <div className="modal-actions">
              <button type="button" className="primary" onClick={saveEdit}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {message ? <p className="status">{message}</p> : null}
    </section>
  );
}
