import { useState } from "react";
import { api, authHeaders } from "../api/api";

const CSV_HEADER =
  "type,source_id,category,lang,title,description,meta_title,meta_description,image,address,map_url,phone,website,tags,price_range,rating,review_count,is_published,source_name,source_url";

const CSV_EXAMPLE =
  "place,gmap_123,attractions,th,วัดหนองป่าพง,วัดสายป่าบรรยากาศสงบเหมาะกับการปฏิบัติธรรม,วัดหนองป่าพง,วัดปฏิบัติธรรมในอุบลราชธานี,/uploads/example.jpg,อุบลราชธานี,https://maps.google.com/?q=...,0812345678,https://example.com,วัด|ปฏิบัติธรรม,,4.6,102,1,Google Maps,https://maps.google.com/...";

export default function ImportCsv({ token, role = "user" }) {
  const [csvText, setCsvText] = useState("");
  const [importingCsv, setImportingCsv] = useState(false);
  const [message, setMessage] = useState("");

  async function onCsvFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const textValue = await file.text();
      setCsvText(String(textValue || ""));
      setMessage("โหลดไฟล์ CSV เข้าช่องแก้ไขแล้ว");
    } catch {
      setMessage("อ่านไฟล์ CSV ไม่สำเร็จ");
    } finally {
      e.target.value = "";
    }
  }

  async function onImportCsv() {
    if (role !== "admin" && role !== "owner") return;

    const payload = String(csvText || "").trim();
    if (!payload) {
      setMessage("กรุณาใส่ข้อมูล CSV ก่อนเริ่มนำเข้า");
      return;
    }

    setImportingCsv(true);
    setMessage("");
    try {
      const res = await api.post("/places/import-csv", { csvText: payload }, { headers: authHeaders(token) });

      const created = Number(res?.data?.created || 0);
      const updated = Number(res?.data?.updated || 0);
      const rejected = Number(res?.data?.rejected || 0);
      const parsed = Number(res?.data?.parsed_rows || 0);

      setMessage(`นำเข้า CSV สำเร็จ | parsed: ${parsed}, created: ${created}, updated: ${updated}, rejected: ${rejected}`);
      setCsvText("");
    } catch (err) {
      setMessage(err?.response?.data?.error || err?.message || "นำเข้า CSV ไม่สำเร็จ");
    } finally {
      setImportingCsv(false);
    }
  }

  if (role !== "admin" && role !== "owner") {
    return (
      <section className="admin-card">
        <h2>นำเข้า CSV</h2>
        <p className="muted">คุณไม่มีสิทธิ์นำเข้าไฟล์ CSV</p>
      </section>
    );
  }

  return (
    <section className="admin-card">
      <div className="card-title-row">
        <h2>นำเข้า CSV สถานที่</h2>
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        วางข้อมูล CSV จาก pipeline แล้วนำเข้ารายการสถานที่แบบหลายรายการได้ทันที
      </p>

      <div className="preview-box" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: "0 0 8px" }}>หัวตาราง CSV ที่รองรับ</p>
        <code style={{ display: "block", whiteSpace: "pre-wrap", fontSize: 12 }}>{CSV_HEADER}</code>
        <p className="muted" style={{ margin: "10px 0 8px" }}>ตัวอย่าง 1 แถว</p>
        <code style={{ display: "block", whiteSpace: "pre-wrap", fontSize: 12 }}>{CSV_EXAMPLE}</code>
      </div>

      <div className="content-toolbar" style={{ marginBottom: 12 }}>
        <label className="upload-btn inline-upload-btn">
          อัปโหลด CSV
          <input type="file" accept=".csv,text/csv" onChange={onCsvFileChange} />
        </label>
        <button type="button" className="primary" onClick={onImportCsv} disabled={importingCsv}>
          {importingCsv ? "กำลังนำเข้า..." : "นำเข้า CSV"}
        </button>
      </div>

      <textarea
        className="full"
        rows={14}
        placeholder="ตัวอย่างข้อมูล CSV"
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
      />

      {message ? <p className="status">{message}</p> : null}
    </section>
  );
}
