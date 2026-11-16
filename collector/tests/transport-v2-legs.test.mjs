import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { normalizePoint, normalizeStops, normalizeLeg } from "../server/transport-v2-router.mjs";
import { migrateTransportRouteLegs } from "../scripts/migrate-transport-route-legs.mjs";
import { buildTransportBundle } from "../server/transport-v2-publish.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "../database/schema.sql");

function openMemoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const schemaSql = fs.readFileSync(schemaPath, "utf8").replace(/^﻿/, "");
  db.exec(schemaSql);
  return db;
}

test("normalizeLeg: 'out'/'back' pass, missing/'' -> null, invalid throws", () => {
  assert.equal(normalizeLeg("out"), "out");
  assert.equal(normalizeLeg("back"), "back");
  assert.equal(normalizeLeg(undefined), null);
  assert.equal(normalizeLeg(null), null);
  assert.equal(normalizeLeg(""), null);
  assert.throws(() => normalizeLeg("x"), /leg is invalid/);
});

test("normalizePoint: carries leg through, invalid leg throws", () => {
  const out = normalizePoint({ lat: 15, lng: 104, leg: "out" }, 0);
  assert.equal(out.leg, "out");
  const back = normalizePoint({ lat: 15, lng: 104, leg: "back" }, 0);
  assert.equal(back.leg, "back");
  const none = normalizePoint({ lat: 15, lng: 104 }, 0);
  assert.equal(none.leg, null);
  const blank = normalizePoint({ lat: 15, lng: 104, leg: "" }, 0);
  assert.equal(blank.leg, null);
  assert.throws(() => normalizePoint({ lat: 15, lng: 104, leg: "x" }, 0), /leg is invalid/);
});

test("normalizeStops: carries leg through, invalid leg throws", () => {
  const [stop] = normalizeStops([{ name: "Stop A", lat: 15, lng: 104, stop_type: "stop", leg: "back" }]);
  assert.equal(stop.leg, "back");
  const [noLegStop] = normalizeStops([{ name: "Stop B", lat: 15, lng: 104, stop_type: "stop" }]);
  assert.equal(noLegStop.leg, null);
  assert.throws(() => normalizeStops([{ name: "Stop C", lat: 15, lng: 104, stop_type: "stop", leg: "x" }]), /leg is invalid/);
});

test("schema: route_kind and leg columns exist; route created without kind defaults to 'loop'", () => {
  const db = openMemoryDb();
  try {
    const routeColumns = db.prepare("PRAGMA table_info(transport_routes_v2)").all().map((row) => row.name);
    assert.ok(routeColumns.includes("route_kind"));
    const controlPointColumns = db.prepare("PRAGMA table_info(transport_route_control_points_v2)").all().map((row) => row.name);
    assert.ok(controlPointColumns.includes("leg"));
    const stopColumns = db.prepare("PRAGMA table_info(transport_route_stops_v2)").all().map((row) => row.name);
    assert.ok(stopColumns.includes("leg"));

    db.exec(`INSERT INTO transport_routes_v2 (route_name, route_number) VALUES ('Test Route', 'T1')`);
    const row = db.prepare("SELECT route_kind FROM transport_routes_v2 WHERE route_number='T1'").get();
    assert.equal(row.route_kind, "loop");
  } finally {
    db.close();
  }
});

test("migrateTransportRouteLegs: running twice on an already-migrated DB does not throw", () => {
  const db = openMemoryDb();
  try {
    assert.doesNotThrow(() => migrateTransportRouteLegs(db));
    assert.doesNotThrow(() => migrateTransportRouteLegs(db));
    const routeColumns = db.prepare("PRAGMA table_info(transport_routes_v2)").all().map((row) => row.name);
    assert.ok(routeColumns.includes("route_kind"));
  } finally {
    db.close();
  }
});

test("publish: stop with leg keeps leg key, stop without leg omits it", () => {
  const bounds = { min_lat: 15, max_lat: 16, min_lng: 104, max_lng: 105 };
  const viewbox = { x: 0, y: 0, width: 4000, height: 5600 };
  const input = {
    baseMap: { id: 1, map_key: "test-map", title: "Test", bounds, viewbox },
    baseSvgStoragePath: "generated/transport-v2/base.svg",
    labelLayer: { items: [] },
    overlayLayers: [],
    routes: [
      {
        id: 1, route_number: "2", route_name: "สาย 2", vehicle_type: "songthaew", color: "#ff6600", routing_status: "fresh",
        resolved_path: [{ lat: 16, lng: 104 }, { lat: 15, lng: 105 }],
        stops: [
          { order: 0, name: "ตลาด ขา ไป", lat: 15.5, lng: 104.5, stop_type: "stop", leg: "out" },
          { order: 1, name: "ตลาด ไม่มีขา", lat: 15.6, lng: 104.6, stop_type: "stop" },
        ],
      },
    ],
    revision: 1,
  };
  const { bundle } = buildTransportBundle(input);
  const [withLeg, withoutLeg] = bundle.routes[0].stops;
  assert.equal(withLeg.leg, "out");
  assert.ok(!("leg" in withoutLeg));
});
