import "dotenv/config";
import { clearTestAuthTokenCache, getTestAuthToken, resolveTestAuthConfig } from "./lib/test-auth.mjs";

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function main() {
  if (hasFlag("--clear-cache")) {
    const cachePath = await clearTestAuthTokenCache();
    console.log(JSON.stringify({ ok: true, cleared: true, token_cache_path: cachePath }, null, 2));
    return;
  }

  const auth = await getTestAuthToken({ forceRefresh: hasFlag("--refresh") });
  const config = resolveTestAuthConfig();
  const output = {
    ok: true,
    auth_mode: auth.auth_mode,
    base_url: config.base_url,
    token_cache_path: config.token_cache_path,
    cache_hit: auth.cache_hit,
    expires_at: auth.expires_at || null,
    user: auth.user || null,
  };
  if (hasFlag("--print-token")) {
    output.token = auth.token;
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(`get-test-token: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
