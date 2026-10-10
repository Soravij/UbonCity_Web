import test from "node:test";
import assert from "node:assert/strict";
import { toFiniteNumberOrNull } from "../server/evidence-candidates.mjs";

test("toFiniteNumberOrNull: null, undefined, empty and blank strings become null", () => {
  assert.equal(toFiniteNumberOrNull(null), null);
  assert.equal(toFiniteNumberOrNull(undefined), null);
  assert.equal(toFiniteNumberOrNull(""), null);
  assert.equal(toFiniteNumberOrNull(" "), null);
});

test("toFiniteNumberOrNull: real zero is preserved", () => {
  assert.equal(toFiniteNumberOrNull(0), 0);
  assert.equal(toFiniteNumberOrNull("0"), 0);
});

test("toFiniteNumberOrNull: numeric values pass through", () => {
  assert.equal(toFiniteNumberOrNull(4.5), 4.5);
  assert.equal(toFiniteNumberOrNull("4.5"), 4.5);
});

test("toFiniteNumberOrNull: non-numeric values become null", () => {
  assert.equal(toFiniteNumberOrNull("abc"), null);
  assert.equal(toFiniteNumberOrNull(NaN), null);
});
