import { useState } from "react";
import Places from "./Places";
import Events from "./Events";

export default function ContentWorkspace({ token, role, mode = "create", channel = "normal" }) {
  const [tab, setTab] = useState("places");
  const isEmer = String(channel || "").trim().toLowerCase() === "emer";

  return (
    <div className="space-y-3">
      <section className="admin-card" style={{ marginTop: 0 }}>
        <div className="content-toolbar">
          <button
            type="button"
            className={tab === "places" ? "primary" : "ghost"}
            onClick={() => setTab("places")}
          >
            {mode === "create"
              ? (isEmer ? "สร้าง Emergency Place" : "สร้างเนื้อหาสถานที่")
              : (isEmer ? "แก้ไข Emergency Place" : "แก้ไขเนื้อหาสถานที่")}
          </button>
          <button
            type="button"
            className={tab === "events" ? "primary" : "ghost"}
            onClick={() => setTab("events")}
          >
            {mode === "create"
              ? (isEmer ? "สร้าง Emergency Event" : "จัดการ Event")
              : (isEmer ? "แก้ไข Emergency Event" : "จัดการ Event")}
          </button>
        </div>
      </section>

      {tab === "places"
        ? <Places token={token} role={role} mode={mode} channel={channel} />
        : <Events token={token} role={role} channel={channel} />}
    </div>
  );
}
