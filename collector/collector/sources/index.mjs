import { collectFromManualPayload } from "./adapters/manual.mjs";
import { collectFromFacebookPayload } from "./adapters/facebook.mjs";
import { collectFromTikTokPayload } from "./adapters/tiktok.mjs";
import { collectFromGoogleMapsPayload } from "./adapters/google-maps.mjs";
import { collectFromGoogleSearchPayload } from "./adapters/google-search.mjs";

const ADAPTERS = {
  manual: collectFromManualPayload,
  facebook: collectFromFacebookPayload,
  tiktok: collectFromTikTokPayload,
  google_maps: collectFromGoogleMapsPayload,
  google_search: collectFromGoogleSearchPayload,
};

export function listSourceAdapters() {
  return Object.keys(ADAPTERS);
}

export async function collectRawFromAdapter(adapterKey, payload) {
  const key = String(adapterKey || "manual").trim().toLowerCase();
  const runner = ADAPTERS[key];
  if (!runner) {
    throw new Error(`Unsupported adapter: ${adapterKey}`);
  }

  return runner(payload);
}
