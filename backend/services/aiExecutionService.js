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
  const list = Array.isArray(imageInputs) ? imageInputs : [];
  return list
    .map((entry) => {
      const dataUrl = String(entry?.image_url?.url || "").trim();
      if (!dataUrl) return null;
      return decodeDataUrl(dataUrl);
    })
    .filter(Boolean)
    .slice(0, 5);
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
  };
}

export async function requestJsonCompletion({ provider, model, prompt, imageInputs = [] }) {
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
    return requestGoogleJsonCompletion({
      model: normalizedModel,
      prompt: normalizedPrompt,
      imageInputs: normalizedImages,
    });
  }

  return requestOpenAiJsonCompletion({
    model: normalizedModel,
    prompt: normalizedPrompt,
    imageInputs: normalizedImages,
  });
}
