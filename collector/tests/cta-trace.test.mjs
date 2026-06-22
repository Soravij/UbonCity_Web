import test from "node:test";
import assert from "node:assert/strict";

import {
  isCtaTraceEnabled,
  summarizeCtaCandidates,
  summarizeCtaJsonString,
  summarizeCtaValue,
  traceCtaStage,
} from "../services/cta-trace.mjs";

test("candidate and AI phone summaries remain separate", () => {
  const summary = {
    ...summarizeCtaCandidates({ phone: "0804415224" }),
    ...summarizeCtaValue({ phone: "0659391488" }, "ai"),
    ...summarizeCtaValue({ phone: "0812345678" }, "cta"),
  };

  assert.equal(summary.candidate_phone_last4, "5224");
  assert.equal(summary.ai_phone_last4, "1488");
  assert.equal(summary.cta_phone_last4, "5678");
});

test("trace disabled produces no output and trace JSON summary does not parse or throw", () => {
  const previous = process.env.COLLECTOR_CTA_TRACE;
  process.env.COLLECTOR_CTA_TRACE = "0";
  let parseCalled = false;
  const originalJsonParse = JSON.parse;
  const originalError = console.error;
  try {
    JSON.parse = (...args) => {
      parseCalled = true;
      return originalJsonParse(...args);
    };
    let outputCalled = false;
    console.error = () => {
      outputCalled = true;
    };

    assert.equal(isCtaTraceEnabled(), false);
    assert.deepEqual(summarizeCtaJsonString("{bad json", "cta"), {});
    traceCtaStage("disabled", { cta_phone_last4: "5224" });

    assert.equal(parseCalled, false);
    assert.equal(outputCalled, false);
  } finally {
    JSON.parse = originalJsonParse;
    console.error = originalError;
    if (previous == null) {
      delete process.env.COLLECTOR_CTA_TRACE;
    } else {
      process.env.COLLECTOR_CTA_TRACE = previous;
    }
  }
});

test("malformed CTA JSON trace input does not throw", () => {
  const previous = process.env.COLLECTOR_CTA_TRACE;
  process.env.COLLECTOR_CTA_TRACE = "1";
  try {
    assert.doesNotThrow(() => summarizeCtaJsonString("{bad json", "cta"));
    assert.deepEqual(summarizeCtaJsonString("{bad json", "cta"), {
      cta_keys: [],
      cta_phone_last4: null,
    });
  } finally {
    if (previous == null) {
      delete process.env.COLLECTOR_CTA_TRACE;
    } else {
      process.env.COLLECTOR_CTA_TRACE = previous;
    }
  }
});

test("masked phone exposes only last four digits", () => {
  assert.deepEqual(summarizeCtaCandidates({ phone: "080 441 5224" }), {
    candidate_keys: ["phone"],
    candidate_phone_last4: "5224",
  });
});
