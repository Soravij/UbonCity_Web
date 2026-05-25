import assert from "node:assert/strict";
import test from "node:test";

import { requestJsonCompletion } from "../services/aiExecutionService.js";

test("requestJsonCompletion sends Google generateContent payload with inlineData images", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  process.env.GOOGLE_AI_API_KEY = "google-test-key";
  process.env.GOOGLE_AI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      options,
      body: JSON.parse(String(options.body || "{}")),
    });
    return Response.json({
      candidates: [
        {
          content: {
            parts: [{ text: "{\"ok\":true,\"kind\":\"google\"}" }],
          },
        },
      ],
    });
  };

  try {
    const result = await requestJsonCompletion({
      provider: "google",
      model: "gemini-2.5-flash",
      prompt: "Return JSON only.",
      imageInputs: [
        {
          type: "image_url",
          image_url: {
            url: "data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw==",
            detail: "low",
          },
        },
      ],
    });

    assert.deepEqual(result.parsed, { ok: true, kind: "google" });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /models\/gemini-2\.5-flash:generateContent\?key=google-test-key$/);
    const parts = calls[0].body.contents?.[0]?.parts || [];
    assert.equal(parts[0]?.text, "Return JSON only.");
    assert.equal(parts[1]?.inlineData?.mimeType, "image/png");
    assert.equal(parts[1]?.inlineData?.data, "ZmFrZS1pbWFnZS1ieXRlcw==");
    assert.equal(calls[0].body.generationConfig?.responseMimeType, "application/json");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.GOOGLE_AI_BASE_URL;
  }
});
