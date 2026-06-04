import { NextResponse } from "next/server";
import { buildReviewAccessCookieName } from "@/lib/reviewAccess";

export async function POST(req) {
  const formData = await req.formData();
  const reviewId = Number(formData.get("review_id") || 0) || 0;
  const lang = String(formData.get("lang") || "th").trim().toLowerCase() || "th";
  const accessToken = String(formData.get("access_token") || "").trim();
  const expiresIn = Math.max(60, Number(formData.get("expires_in") || 600) || 600);

  if (!reviewId || !accessToken) {
    return NextResponse.json({ error: "Missing review session payload" }, { status: 400 });
  }

  const siteBaseUrl = String(process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  const redirectBaseUrl = siteBaseUrl || req.url;
  const redirectUrl = new URL(
    `/${encodeURIComponent(lang)}/review/${encodeURIComponent(reviewId)}`,
    redirectBaseUrl
  );
  const response = NextResponse.redirect(redirectUrl, { status: 303 });
  response.cookies.set({
    name: buildReviewAccessCookieName(reviewId),
    value: accessToken,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: expiresIn,
    path: "/",
  });
  return response;
}

