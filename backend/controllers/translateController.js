import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function parseModelJson(rawText) {
  const text = String(rawText || "").trim();

  // Handle markdown code fences like ```json ... ```
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const fencedBody = fenceMatch ? fenceMatch[1].trim() : text;

  try {
    return JSON.parse(fencedBody);
  } catch {
    const start = fencedBody.indexOf("{");
    const end = fencedBody.lastIndexOf("}");

    if (start >= 0 && end > start) {
      const maybeJson = fencedBody.slice(start, end + 1);
      return JSON.parse(maybeJson);
    }

    throw new Error("Model response is not valid JSON");
  }
}

function looksCorruptedTranslation(value) {
  const text = String(value || "").trim();
  if (!text) return true;

  const qmarks = (text.match(/\?/g) || []).length;
  if (qmarks >= 3 && qmarks / Math.max(text.length, 1) >= 0.3) return true;

  return false;
}

function isInvalidTranslationPayload(payload) {
  const title = String(payload?.title || "").trim();
  const description = String(payload?.description || "").trim();
  if (!title || !description) return true;

  return looksCorruptedTranslation(title) || looksCorruptedTranslation(description);
}

async function requestTranslation({ title, description, sourceLang, targetLang, languageLabels, strict = false }) {
  const strictLine = strict
    ? "If output contains question-mark placeholders like ???, regenerate proper target-language text."
    : "";

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a professional tourism translator. Translate naturally for travel content. Return only JSON with keys title and description.",
      },
      {
        role: "user",
        content:
          `Source language: ${languageLabels[sourceLang] || sourceLang} (${sourceLang})\n` +
          `Target language: ${languageLabels[targetLang] || targetLang} (${targetLang})\n` +
          "Do not keep the original source text. The output must be fully in the target language.\n" +
          "For target lo, output must be in Lao language (not Thai).\n" +
          `${strictLine}\n\n` +
          `Title: ${title}\n` +
          `Description: ${description}`,
      },
    ],
  });

  const text = response.choices?.[0]?.message?.content;
  return parseModelJson(text);
}

export const autoTranslate = async (req, res) => {
  try {
    const { title, description, sourceLang } = req.body;

    const languages = ["th", "en", "zh", "lo"];
    const languageLabels = {
      th: "Thai",
      en: "English",
      zh: "Chinese (Simplified)",
      lo: "Lao",
    };
    const targets = languages.filter((l) => l !== sourceLang);

    const result = {};

    for (const lang of targets) {
      let parsed = await requestTranslation({
        title,
        description,
        sourceLang,
        targetLang: lang,
        languageLabels,
      });

      if (isInvalidTranslationPayload(parsed)) {
        parsed = await requestTranslation({
          title,
          description,
          sourceLang,
          targetLang: lang,
          languageLabels,
          strict: true,
        });
      }

      result[lang] = {
        title: parsed?.title || "",
        description: parsed?.description || "",
      };
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
