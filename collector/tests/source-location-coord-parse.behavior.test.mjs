import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const APP_JS_PATH = path.resolve(collectorRoot, "server", "public", "app.js");

function loadCoordParsers() {
  const src = fs.readFileSync(APP_JS_PATH, "utf8");

  const extractFunction = (name) => {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`function ${name} not found in app.js`);
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i += 1) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") {
        depth -= 1;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    throw new Error(`unbalanced braces while extracting ${name}`);
  };

  const constMatch = src.match(/^const PLUS_CODE_ALPHABET = .*;$/m);
  if (!constMatch) throw new Error("PLUS_CODE_ALPHABET not found in app.js");

  const names = [
    "parseDmsCoordinate",
    "decodeFullPlusCode",
    "roundCoord",
    "isValidCoordPair",
    "parseCoordinatePasteText",
  ];
  const body = `${constMatch[0]}\n${names.map(extractFunction).join("\n\n")}`;
  const fn = new Function(`${body}\nreturn { ${names.join(", ")} };`);
  return fn();
}

const { parseDmsCoordinate, parseCoordinatePasteText } = loadCoordParsers();
const TOL = 0.0002;

function assertPair(actual, lat, lng) {
  assert.ok(actual, "expected a parsed pair, got null");
  assert.equal(actual.needsResolve, undefined);
  assert.ok(Math.abs(actual.lat - lat) <= TOL, `lat ${actual.lat} != ${lat}`);
  assert.ok(Math.abs(actual.lng - lng) <= TOL, `lng ${actual.lng} != ${lng}`);
}

test("parseDmsCoordinate keeps single-value behavior", () => {
  assert.ok(Math.abs(parseDmsCoordinate(`15°13'53.7"N`) - 15.231583) <= TOL);
});

test("decimal pair with comma", () => {
  assertPair(parseCoordinatePasteText("15.244712, 104.847234"), 15.244712, 104.847234);
});

test("decimal pair with space", () => {
  assertPair(parseCoordinatePasteText("15.2447 104.8472"), 15.2447, 104.8472);
});

test("DMS pair lat first", () => {
  assertPair(parseCoordinatePasteText(`15°13'53.7"N 104°51'31.6"E`), 15.231583, 104.858778);
});

test("DMS pair lng first (swapped order)", () => {
  assertPair(parseCoordinatePasteText(`104°51'31.6"E 15°13'53.7"N`), 15.231583, 104.858778);
});

test("DMS pair with typographic symbols and comma", () => {
  assertPair(parseCoordinatePasteText(`15˚13′53.7″N, 104˚51′31.6″E`), 15.231583, 104.858778);
});

test("Google Maps URL prefers !3d!4d pin over @ viewport", () => {
  assertPair(
    parseCoordinatePasteText("https://www.google.com/maps/place/X/@15.1,104.1,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d15.244712!4d104.847234"),
    15.244712,
    104.847234,
  );
});

test("Google Maps URL with q= param", () => {
  assertPair(parseCoordinatePasteText("https://www.google.com/maps?q=15.2447,104.8472"), 15.2447, 104.8472);
});

test("full plus code decodes", () => {
  assertPair(parseCoordinatePasteText("8FVC9G8F+6X"), 47.36556, 8.52494);
});

test("short plus code needs resolve", () => {
  const r = parseCoordinatePasteText("7Q6R+X2 อุบลราชธานี");
  assert.equal(r?.needsResolve, "plus_code_short");
});

test("short map link needs resolve", () => {
  const r = parseCoordinatePasteText("https://maps.app.goo.gl/abc123");
  assert.equal(r?.needsResolve, "short_link");
});

test("single number and garbage return null", () => {
  assert.equal(parseCoordinatePasteText("15.2447"), null);
  assert.equal(parseCoordinatePasteText("abc"), null);
});

test("DMS pair with S/W hemispheres yields negative values", () => {
  assertPair(parseCoordinatePasteText(`15°13'53.7"S 104°51'31.6"W`), -15.231583, -104.858778);
});

test("DMS pair with latitude out of range for its axis returns null", () => {
  assert.equal(parseCoordinatePasteText(`15°13'53.7"N 16°00'00"S`), null);
});
