import assert from "node:assert/strict";
import test from "node:test";
import { buildTransportBundle, projectToViewbox, publishMapKey } from "../server/transport-v2-publish.mjs";

const bounds = { min_lat: 15, max_lat: 16, min_lng: 104, max_lng: 105 };
const viewbox = { x: 0, y: 0, width: 4000, height: 5600 };
const input = () => ({
  baseMap: { id: 3, map_key: "Ubon City_v1", title: "Ubon", bounds, viewbox },
  baseSvgStoragePath: "generated/transport-v2/base.svg",
  labelLayer: { items: [
    { label_key: "a", label_category: "landmark", anchor_x: 10.04, anchor_y: 20, priority: 2, texts: { th: "ก", en: "A", zh: "甲" }, locale_offsets: {}, style: { size_preset: "l", text_color: "#111111" } },
    { label_key: "b", label_category: "landmark", anchor_x: 1, anchor_y: 1, texts: { en: "no thai" } },
  ] },
  overlayLayers: [{ overlay_id: "Logo 1", storagePath: "x/logo.PNG", anchor_x: 1, anchor_y: 2, width: 30, height: 40 }],
  routes: [
    { id: 1, route_number: "2", route_name: "สาย 2", vehicle_type: "songthaew", color: "#ff6600", routing_status: "fresh",
      resolved_path: [{ lat: 16, lng: 104 }, { lat: 15, lng: 105 }], stops: [{ order: 1, name: " ตลาด ", lat: 15.5, lng: 104.5, stop_type: "stop" }] },
    { id: 2, route_number: "3", route_name: "สาย 3", vehicle_type: "bus", color: "#0000ff", routing_status: "stale", resolved_path: [] },
    { id: 4, route_number: "5", route_name: "สาย 5", vehicle_type: "bus", color: "#0000ff", routing_status: "fresh", resolved_path: [{ lat: 15, lng: 104 }] },
  ],
  revision: 123,
});

test("projectToViewbox: corners map to viewbox corners", () => {
  assert.deepEqual(projectToViewbox(16, 104, bounds, viewbox), [0, 0]);
  assert.deepEqual(projectToViewbox(15, 105, bounds, viewbox), [4000, 5600]);
});
test("publishMapKey sanitizes", () => assert.equal(publishMapKey({ map_key: "Ubon City_v1" }), "ubon-city-v1"));
test("bundle: routes, skipped, labels, overlays, files", () => {
  const { bundle, files, skipped, problems } = buildTransportBundle(input());
  assert.deepEqual(problems, []);
  assert.equal(bundle.map_key, "ubon-city-v1");
  assert.deepEqual(bundle.routes.map((r) => r.id), [1]);
  assert.deepEqual(bundle.routes[0].path, [[0, 0], [4000, 5600]]);
  assert.deepEqual(bundle.routes[0].stops, [{ order: 1, name: "ตลาด", type: "stop", x: 2000, y: 2800 }]);
  assert.deepEqual(skipped, [{ id: 2, number: "3", reason: "routing_status=stale" }, { id: 4, number: "5", reason: "no resolved path" }]);
  assert.equal(bundle.labels.length, 1);
  assert.deepEqual(bundle.labels[0].texts, { th: "ก", en: "A" });
  assert.equal(bundle.labels[0].x, 10);
  assert.deepEqual(bundle.overlays[0], { id: "Logo 1", file: "overlay-1.png", x: 1, y: 2, width: 30, height: 40, scale_with_zoom: true });
  assert.deepEqual(files.map((f) => f.name), ["base.svg", "overlay-1.png"]);
});
test("bundle: problems when nothing publishable", () => {
  const i = input(); i.baseSvgStoragePath = ""; i.routes = [];
  assert.deepEqual(buildTransportBundle(i).problems, ["base map has no SVG asset", "no route ready to publish"]);
});
test("bundle: invalid route number/name goes to skipped, overlay names never collide", () => {
  const i = input();
  i.routes.push({ id: 9, route_number: "", route_name: "x", vehicle_type: "bus", color: "#000000", routing_status: "fresh",
    resolved_path: [{ lat: 15, lng: 104 }, { lat: 16, lng: 105 }] });
  i.overlayLayers.push({ overlay_id: "logo-1", storagePath: "y/logo.png", anchor_x: 0, anchor_y: 0, width: 1, height: 1 });
  const { bundle, skipped } = buildTransportBundle(i);
  assert.ok(skipped.some((s) => s.id === 9 && s.reason === "invalid number or name"));
  assert.deepEqual(bundle.overlays.map((o) => o.file), ["overlay-1.png", "overlay-2.png"]);
});
