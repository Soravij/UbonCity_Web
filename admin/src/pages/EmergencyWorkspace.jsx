import { useState } from "react";
import Places from "./Places";
import Events from "./Events";
import ImportCsv from "./ImportCsv";
import MediaLibrary from "./MediaLibrary";

export default function EmergencyWorkspace({ token, role }) {
  const [entityTab, setEntityTab] = useState("places");
  const [placeMode, setPlaceMode] = useState("edit");

  return (
    <div className="space-y-3">
      <section className="admin-card" style={{ marginTop: 0 }}>
        <div className="content-toolbar">
          <button
            type="button"
            className={entityTab === "places" ? "primary" : "ghost"}
            onClick={() => setEntityTab("places")}
          >
            Emergency Places
          </button>
          <button
            type="button"
            className={entityTab === "events" ? "primary" : "ghost"}
            onClick={() => setEntityTab("events")}
          >
            Emergency Events
          </button>
          <button
            type="button"
            className={entityTab === "import-csv" ? "primary" : "ghost"}
            onClick={() => setEntityTab("import-csv")}
          >
            Import CSV
          </button>
          <button
            type="button"
            className={entityTab === "media-library" ? "primary" : "ghost"}
            onClick={() => setEntityTab("media-library")}
          >
            Media Library
          </button>
        </div>
      </section>

      {entityTab === "places" ? (
        <>
          <section className="admin-card" style={{ marginTop: 0 }}>
            <div className="content-toolbar">
              <button
                type="button"
                className={placeMode === "edit" ? "primary" : "ghost"}
                onClick={() => setPlaceMode("edit")}
              >
                List & Edit
              </button>
              <button
                type="button"
                className={placeMode === "create" ? "primary" : "ghost"}
                onClick={() => setPlaceMode("create")}
              >
                Create New
              </button>
            </div>
          </section>
          <Places token={token} role={role} mode={placeMode} channel="emer" />
        </>
      ) : entityTab === "events" ? (
        <Events token={token} role={role} channel="emer" />
      ) : entityTab === "import-csv" ? (
        <ImportCsv token={token} role={role} />
      ) : (
        <MediaLibrary token={token} role={role} />
      )}
    </div>
  );
}
