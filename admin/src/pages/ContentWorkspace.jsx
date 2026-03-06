import { useState } from "react";
import Places from "./Places";
import Events from "./Events";

export default function ContentWorkspace({ token, role, mode = "create" }) {
  const [tab, setTab] = useState("places");

  return (
    <div className="space-y-3">
      <section className="admin-card" style={{ marginTop: 0 }}>
        <div className="content-toolbar">
          <button
            type="button"
            className={tab === "places" ? "primary" : "ghost"}
            onClick={() => setTab("places")}
          >
            {mode === "create" ? "สร้างเนื้อหาสถานที่" : "แก้ไขเนื้อหาสถานที่"}
          </button>
          <button
            type="button"
            className={tab === "events" ? "primary" : "ghost"}
            onClick={() => setTab("events")}
          >
            จัดการ Event
          </button>
        </div>
      </section>

      {tab === "places" ? <Places token={token} role={role} mode={mode} /> : <Events token={token} role={role} />}
    </div>
  );
}
