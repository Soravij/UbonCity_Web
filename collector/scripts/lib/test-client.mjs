import "dotenv/config";
import { getTestAuthToken, resolveTestBaseUrl } from "./test-auth.mjs";

function normalizeHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value == null) continue;
    out[String(key)] = String(value);
  }
  return out;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function requestJson(pathname, {
  method = "GET",
  body,
  headers = {},
  auth = true,
  token = "",
  forceRefreshToken = false,
  baseUrl = "",
  timeoutMs = Number(process.env.COLLECTOR_TEST_REQUEST_TIMEOUT_MS || 30000) || 30000,
} = {}) {
  const requestHeaders = normalizeHeaders(headers);
  let authToken = token;
  if (auth && !authToken) {
    const authResult = await getTestAuthToken({ forceRefresh: forceRefreshToken });
    authToken = authResult.token;
  }
  if (authToken) {
    requestHeaders.Authorization = `Bearer ${authToken}`;
  }
  if (body !== undefined) {
    requestHeaders["Content-Type"] = requestHeaders["Content-Type"] || "application/json";
  }

  const targetUrl = `${baseUrl || resolveTestBaseUrl()}${pathname}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`request timeout after ${timeoutMs}ms`)), timeoutMs);
  let response;
  try {
    response = await fetch(targetUrl, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const message = String(error?.message || error || "fetch failed");
    const cause = String(error?.cause?.message || "").trim();
    const details = [
      `${method} ${targetUrl} failed`,
      `error=${message}`,
    ];
    if (cause) {
      details.push(`cause=${cause}`);
    }
    throw new Error(details.join(" "));
  } finally {
    clearTimeout(timeoutId);
  }
  const payload = await parseResponse(response);
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    body: payload,
  };
}

export function createTestClient(options = {}) {
  return {
    request(pathname, requestOptions = {}) {
      return requestJson(pathname, { ...options, ...requestOptions });
    },
    get(pathname, requestOptions = {}) {
      return requestJson(pathname, { ...options, ...requestOptions, method: "GET" });
    },
    post(pathname, body, requestOptions = {}) {
      return requestJson(pathname, { ...options, ...requestOptions, method: "POST", body });
    },
    patch(pathname, body, requestOptions = {}) {
      return requestJson(pathname, { ...options, ...requestOptions, method: "PATCH", body });
    },
    del(pathname, requestOptions = {}) {
      return requestJson(pathname, { ...options, ...requestOptions, method: "DELETE" });
    },
    jsonRpc(methodName, params, requestOptions = {}) {
      const id = Number(requestOptions.id || Date.now());
      return requestJson("/api/mcp", {
        ...options,
        ...requestOptions,
        method: "POST",
        body: {
          jsonrpc: "2.0",
          id,
          method: methodName,
          params,
        },
      });
    },
  };
}
