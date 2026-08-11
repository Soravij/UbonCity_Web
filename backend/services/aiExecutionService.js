import pool from "../config/db.js";

const TOKEN_EXTRACTORS = {
  google: (usage) => ({
    promptTokens: usage?.promptTokenCount ?? null,
    candidatesTokens: usage?.candidatesTokenCount ?? null,
    totalTokens: usage?.totalTokenCount ?? null,
  }),
  openai: (usage) => ({
    promptTokens: usage?.prompt_tokens ?? null,
    candidatesTokens: usage?.completion_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
  }),
};

function parseJsonLike(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenceMatch ? fenceMatch[1].trim() : text;

  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeProvider(provider) {
  return String(provider || "").trim().toLowerCase() === "google" ? "google" : "openai";
}

function getGoogleBaseUrl() {
  return String(process.env.GOOGLE_AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta")
    .trim()
    .replace(/\/$/, "");
}

function getOpenAiBaseUrl() {
  return String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1")
    .trim()
    .replace(/\/$/, "");
}

function getProviderCredentials(provider) {
  const normalizedProvider = normalizeProvider(provider);
  if (normalizedProvider === "google") {
    const apiKey = String(
      process.env.GOOGLE_AI_API_KEY
      || process.env.GEMINI_API_KEY
      || process.env.GOOGLE_API_KEY
      || ""
    ).trim();
    if (!apiKey) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }
    return {
      provider: "google",
      apiKey,
      baseUrl: getGoogleBaseUrl(),
    };
  }

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return {
    provider: "openai",
    apiKey,
    baseUrl: getOpenAiBaseUrl(),
  };
}

function decodeDataUrl(url) {
  const match = String(url || "").match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) {
    throw new Error("Only base64 data URLs are supported for image inputs");
  }
  return {
    mimeType: String(match[1] || "").trim() || "image/jpeg",
    data: String(match[2] || "").trim(),
  };
}

function normalizeImageInputs(imageInputs = []) {
  const maxImages = Math.max(1, Number(process.env.BACKEND_AI_MAX_IMAGE_INPUTS || 10) || 10);
  const list = Array.isArray(imageInputs) ? imageInputs : [];
  const normalized = list
    .map((entry) => {
      const dataUrl = String(entry?.image_url?.url || "").trim();
      if (!dataUrl) return null;
      return decodeDataUrl(dataUrl);
    })
    .filter(Boolean);
  if (normalized.length > maxImages) {
    console.error(`[aiExecutionService] normalizeImageInputs: slicing ${normalized.length} -> ${maxImages} (BACKEND_AI_MAX_IMAGE_INPUTS=${maxImages})`);
  }
  return normalized.slice(0, maxImages);
}

function buildOpenAiContent(prompt, imageInputs = []) {
  if (!imageInputs.length) return prompt;
  return [
    { type: "text", text: String(prompt || "") },
    ...imageInputs.map((entry) => ({
      type: "image_url",
      image_url: {
        url: `data:${entry.mimeType};base64,${entry.data}`,
        detail: "low",
      },
    })),
  ];
}

function buildGoogleParts(prompt, imageInputs = []) {
  return [
    { text: String(prompt || "") },
    ...imageInputs.map((entry) => ({
      inlineData: {
        mimeType: entry.mimeType,
        data: entry.data,
      },
    })),
  ];
}

function extractGoogleText(data) {
  return String(
    data?.candidates?.[0]?.content?.parts?.find((part) => typeof part?.text === "string")?.text || ""
  ).trim();
}

function extractOpenAiText(data) {
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

async function requestOpenAiJsonCompletion({ model, prompt, imageInputs = [] }) {
  const credentials = getProviderCredentials("openai");
  const response = await fetch(`${credentials.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.apiKey}`,
    },
    body: JSON.stringify({
      model: String(model || "").trim(),
      messages: [
        {
          role: "user",
          content: buildOpenAiContent(prompt, imageInputs),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI error ${response.status}: ${body.slice(0, 220)}`);
  }

  const data = await response.json();
  const outputText = extractOpenAiText(data);
  return {
    provider: "openai",
    outputText,
    parsed: parseJsonLike(outputText),
    usageMetadata: data?.usage ?? null,
  };
}

async function requestGoogleJsonCompletion({ model, prompt, imageInputs = [] }) {
  const credentials = getProviderCredentials("google");
  const response = await fetch(
    `${credentials.baseUrl}/models/${encodeURIComponent(String(model || "").trim())}:generateContent?key=${encodeURIComponent(credentials.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: buildGoogleParts(prompt, imageInputs),
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google AI error ${response.status}: ${body.slice(0, 220)}`);
  }

  const data = await response.json();
  const outputText = extractGoogleText(data);
  return {
    provider: "google",
    outputText,
    parsed: parseJsonLike(outputText),
    usageMetadata: data?.usageMetadata ?? null,
  };
}

async function logAiUsage({ actorEmail, task, provider, model, usageMetadata }) {
  try {
    let userId = null;
    if (actorEmail) {
      const [rows] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [actorEmail]);
      if (rows.length) userId = rows[0].id;
    }

    const extractor = TOKEN_EXTRACTORS[provider];
    const normalized = extractor ? extractor(usageMetadata) : { promptTokens: null, candidatesTokens: null, totalTokens: null };
    const { promptTokens, candidatesTokens, totalTokens } = normalized;

    if (usageMetadata && !extractor && promptTokens === null && candidatesTokens === null && totalTokens === null) {
      console.warn(`[aiExecutionService] logAiUsage: no token extractor for provider="${provider}", raw keys: [${Object.keys(usageMetadata).join(", ")}]`);
    }

    await pool.query(
      "INSERT INTO ai_usage_log (actor_email, user_id, task, provider, model, prompt_tokens, candidates_tokens, total_tokens, raw_usage_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [actorEmail || null, userId, task || "unknown", provider, model, promptTokens, candidatesTokens, totalTokens, usageMetadata ? JSON.stringify(usageMetadata) : null]
    );
  } catch (err) {
    console.error("[aiExecutionService] logAiUsage failed:", err?.message || err);
  }
}

export async function requestJsonCompletion({ provider, model, prompt, imageInputs = [], task, actorEmail }) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = String(model || "").trim();
  const normalizedPrompt = String(prompt || "").trim();
  const normalizedImages = normalizeImageInputs(imageInputs);

  if (!normalizedModel) {
    throw new Error("model is required");
  }
  if (!normalizedPrompt) {
    throw new Error("prompt is required");
  }

  if (normalizedProvider === "google") {
    const result = await requestGoogleJsonCompletion({
      model: normalizedModel,
      prompt: normalizedPrompt,
      imageInputs: normalizedImages,
    });
    logAiUsage({ actorEmail, task, provider: "google", model: normalizedModel, usageMetadata: result.usageMetadata });
    return result;
  }

  const result = await requestOpenAiJsonCompletion({
    model: normalizedModel,
    prompt: normalizedPrompt,
    imageInputs: normalizedImages,
  });
  logAiUsage({ actorEmail, task, provider: "openai", model: normalizedModel, usageMetadata: result.usageMetadata });
  return result;
}
