import { NextResponse } from "next/server";

function getBackendOrigin() {
  const raw = String(process.env.NEXT_PUBLIC_API_URL || "").trim();
  if (raw && /^https?:\/\//i.test(raw)) {
    return raw.replace(/\/api\/?$/i, "").replace(/\/+$/, "");
  }
  return "http://localhost:5000";
}

function normalizeUploadsPath(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  if (raw.startsWith("uploads/")) return `/${raw}`;
  if (raw.startsWith("/uploads/")) return raw;
  return "";
}

function resolveProxyTarget(reqUrl) {
  const requestUrl = new URL(reqUrl);
  const backendOrigin = getBackendOrigin();
  const pathValue = normalizeUploadsPath(requestUrl.searchParams.get("path"));
  if (pathValue) return `${backendOrigin}${pathValue}`;

  const rawUrl = String(requestUrl.searchParams.get("url") || "").trim();
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    const normalizedPath = normalizeUploadsPath(parsed.pathname);
    if (!normalizedPath) return "";
    return `${backendOrigin}${normalizedPath}`;
  } catch {
    return "";
  }
}

export async function GET(req) {
  const targetUrl = resolveProxyTarget(req.url);
  if (!targetUrl) {
    return NextResponse.json({ error: "Invalid review media target" }, { status: 400 });
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, { cache: "no-store" });
  } catch {
    return NextResponse.json({ error: "Failed to fetch review media" }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: "Review media not found" }, { status: upstream.status });
  }

  const headers = new Headers();
  const contentType = String(upstream.headers.get("content-type") || "").trim();
  const contentLength = String(upstream.headers.get("content-length") || "").trim();
  if (contentType) headers.set("content-type", contentType);
  if (contentLength) headers.set("content-length", contentLength);
  headers.set("cache-control", "no-store");

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}
