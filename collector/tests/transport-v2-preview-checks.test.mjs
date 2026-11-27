import { test } from "node:test";
import assert from "node:assert/strict";
import { colorClashes, routeCardModel } from "../server/public/transport-v2-preview-checks.js";

const bounds = { min_lat: 15, max_lat: 15.1, min_lng: 104, max_lng: 104.1 };
const viewbox = { x: 0, y: 0, width: 1000, height: 1000 };

function bundleWith(routes) {
  return { bounds, viewbox, routes };
}

test("colorClashes: same colour, parallel lines 10 units apart -> 1 clash", () => {
  const routes = [
    { id: 1, number: "1", color: "#ff0000", path: [[0, 0], [100, 0]] },
    { id: 2, number: "2", color: "#ff0000", path: [[0, 10], [100, 10]] },
  ];
  const result = colorClashes(bundleWith(routes));
  assert.equal(result.length, 1);
  assert.equal(result[0].a, "1");
  assert.equal(result[0].b, "2");
});

test("colorClashes: same colour, 100 units apart -> 0 clashes", () => {
  const routes = [
    { id: 1, number: "1", color: "#ff0000", path: [[0, 0], [100, 0]] },
    { id: 2, number: "2", color: "#ff0000", path: [[0, 100], [100, 100]] },
  ];
  assert.equal(colorClashes(bundleWith(routes)).length, 0);
});

test("colorClashes: different colours, 10 units apart -> 0 clashes", () => {
  const routes = [
    { id: 1, number: "1", color: "#ff0000", path: [[0, 0], [100, 0]] },
    { id: 2, number: "2", color: "#00ff00", path: [[0, 10], [100, 10]] },
  ];
  assert.equal(colorClashes(bundleWith(routes)).length, 0);
});

test("colorClashes: colour case is normalized", () => {
  const routes = [
    { id: 1, number: "1", color: "#AABBCC", path: [[0, 0], [100, 0]] },
    { id: 2, number: "2", color: "#aabbcc", path: [[0, 10], [100, 10]] },
  ];
  assert.equal(colorClashes(bundleWith(routes)).length, 1);
});

test("routeCardModel: en uses description_en", () => {
  const route = {
    number: "1",
    name: "Test",
    vehicle_type: "bus",
    fare_baht: 20,
    description: "th desc",
    description_en: "en desc",
    stops: [],
  };
  const card = routeCardModel(route, "en");
  const info = card.rows.find(([k]) => k === "Info");
  assert.deepEqual(info, ["Info", "en desc"]);
});

test("routeCardModel: en falls back to description when description_en is empty", () => {
  const route = {
    number: "1",
    name: "Test",
    vehicle_type: "bus",
    fare_baht: 20,
    description: "th desc",
    description_en: "",
    stops: [],
  };
  const card = routeCardModel(route, "en");
  const info = card.rows.find(([k]) => k === "Info");
  assert.deepEqual(info, ["Info", "th desc"]);
});

test("routeCardModel: fare_baht null means no Fare row", () => {
  const route = {
    number: "1",
    name: "Test",
    vehicle_type: "bus",
    fare_baht: null,
    description: "d",
    stops: [],
  };
  const card = routeCardModel(route, "th");
  assert.equal(card.rows.some(([k]) => k === "ค่าโดยสาร"), false);
});

test("routeCardModel: From-To uses out stops sorted by order, skipping leg back", () => {
  const route = {
    number: "1",
    name: "Test",
    vehicle_type: "bus",
    fare_baht: 20,
    description: "d",
    stops: [
      { name: "B", order: 2, leg: "out" },
      { name: "A", order: 1, leg: "out" },
      { name: "Z-back", order: 1, leg: "back" },
    ],
  };
  const card = routeCardModel(route, "th");
  const fromTo = card.rows.find(([k]) => k === "ต้นทาง – ปลายทาง");
  assert.deepEqual(fromTo, ["ต้นทาง – ปลายทาง", "A – B"]);
});

test("routeCardModel: photo_url is sanitized to /media/ paths only", () => {
  const base = { number: "1", name: "Test", vehicle_type: "bus", fare_baht: 20, description: "d", stops: [] };
  const safe = routeCardModel({ ...base, photo_url: "/media/a.webp" }, "th");
  assert.equal(safe.photo, "/media/a.webp");
  const jsUrl = routeCardModel({ ...base, photo_url: "javascript:x" }, "th");
  assert.equal(jsUrl.photo, "");
  const externalUrl = routeCardModel({ ...base, photo_url: "https://x/a.jpg" }, "th");
  assert.equal(externalUrl.photo, "");
});

test("routeCardModel: vehicle songthaew th label", () => {
  const route = {
    number: "1",
    name: "Test",
    vehicle_type: "songthaew",
    fare_baht: 20,
    description: "d",
    stops: [],
  };
  const card = routeCardModel(route, "th");
  const vehicle = card.rows.find(([k]) => k === "ประเภทรถ");
  assert.deepEqual(vehicle, ["ประเภทรถ", "สองแถว"]);
});
