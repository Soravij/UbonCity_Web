import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL, api, authHeaders } from "../api/api";

const CATEGORIES = ["attractions", "activities", "hotels", "cafes", "restaurants", "transport"];
const DELETE_CONTENT_TARGET_STORAGE_KEY = "delete_content_target";
const CATEGORY_LABEL = {
  attractions: "Attractions",
  activities: "Activities",
  hotels: "Hotels",
  cafes: "Cafes",
  restaurants: "Restaurants",
  transport: "Transport",
};

function resolveFrontendBaseUrl() {
  const raw = String(import.meta.env.VITE_FRONTEND_URL || "").trim();
  if (raw) return raw.replace(/\/+$/, "");
  const hostname = String(window.location.hostname || "").trim().toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3000";
  return "";
}

function resolveCollectorBaseUrl() {
  const raw = String(import.meta.env.VITE_COLLECTOR_BASE_URL || "").trim();
  if (raw) return raw.replace(/\/+$/, "");
  const hostname = String(window.location.hostname || "").trim().toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:5060";
  return "";
}

function resolveBackendOrigin() {
  try {
    const resolved = new URL(API_BASE_URL, window.location.origin);
    return `${resolved.protocol}//${resolved.host}`;
  } catch {
    return "http://localhost:5000";
  }
}

function absolutizeUrl(value, baseUrl) {
  const raw = String(value || "").trim();
  const base = String(baseUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!base) return raw;
  try {
    return new URL(raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`, `${base}/`).toString();
  } catch {
    return raw;
  }
}

function pickMediaSourceUrl(entry) {
  const backendOrigin = resolveBackendOrigin();
  const collectorBase = resolveCollectorBaseUrl();
  const backendUrl = absolutizeUrl(entry?.backend_url || entry?.url, backendOrigin);
  if (backendUrl) return backendUrl;
  return absolutizeUrl(entry?.source_url, collectorBase);
}

function pickBackendMediaUrl(entry) {
  const backendOrigin = resolveBackendOrigin();
  const value = String(entry?.backend_url || entry?.url || "").trim();
  return value ? absolutizeUrl(value, backendOrigin) : "";
}

function resolveLegacyFallbackCoverUrl(item) {
  const backendOrigin = resolveBackendOrigin();
  const candidates = [
    item?.effective_cover_image,
    item?.media_cover_image,
    item?.decision_cover_image,
    item?.article_snapshot?.image,
    item?.image,
  ];
  for (const candidate of candidates) {
    const normalized = absolutizeUrl(candidate, backendOrigin);
    if (normalized) return normalized;
  }
  return "";
}

function isLegacyReviewItem(item) {
  if (Number(item?.review_content_id || 0) > 0) return false;
  const manifest = item?.article_snapshot?.media_manifest || {};
  const cover = manifest?.cover;
  const gallery = Array.isArray(manifest?.gallery) ? manifest.gallery : [];
  const inline = Array.isArray(manifest?.inline) ? manifest.inline : [];
  const entries = [cover, ...gallery, ...inline].filter(Boolean);
  if (!entries.length) return true;
  const hasBackendMediaRef = entries.some((entry) => Boolean(pickBackendMediaUrl(entry)));
  return !hasBackendMediaRef;
}

function buildReviewIngestPayload(item) {
  const snapshot = item?.article_snapshot || {};
  const media = snapshot?.media_manifest || {};
  const coverSource = pickMediaSourceUrl(media?.cover);
  const legacyFallbackCover = resolveLegacyFallbackCoverUrl(item);
  const gallery = Array.isArray(media?.gallery) ? media.gallery : [];
  const inline = Array.isArray(media?.inline) ? media.inline : [];
  const sourceBaseUrl = String(snapshot?.source_base_url || item?.source_base_url || resolveCollectorBaseUrl()).trim();
  return {
    source_system: "collector-app",
    source_content_item_id: Number(item?.source_content_item_id || 0) || 0,
    source_base_url: sourceBaseUrl,
    content: {
      content_type: item?.source_content_type === "event" ? "event" : "place",
      lang: String(item?.source_lang || "th").trim().toLowerCase() || "th",
      category: item?.source_content_type === "event" ? "event" : (snapshot?.category || item?.category || "attractions"),
      slug: snapshot?.slug || item?.slug || null,
      title: snapshot?.title || item?.title || "",
      body: snapshot?.description || item?.description || "",
      excerpt: snapshot?.excerpt || null,
      meta_title: snapshot?.meta_title || item?.meta_title || null,
      meta_description: snapshot?.meta_description || item?.meta_description || null,
      event_period_text: snapshot?.event_period_text || null,
      location_text: snapshot?.location_text || null,
      latitude: snapshot?.latitude ?? null,
      longitude: snapshot?.longitude ?? null,
      map_url: snapshot?.map_url || null,
      google_place_id: snapshot?.google_place_id || null,
      transport_subtype: snapshot?.transport_subtype || null,
      transport_contact_name: snapshot?.transport_contact_name || null,
      transport_contact_phone: snapshot?.transport_contact_phone || null,
      transport_contact_details: snapshot?.transport_contact_details || null,
      transport_link_url: snapshot?.transport_link_url || null,
      public_entity_type: item?.source_content_type === "event" ? "event" : "place",
      public_entity_id: Number(item?.entity_id || item?.local_entity_id || 0) || null,
      translation_langs: Array.isArray(item?.translation_langs) ? item.translation_langs : [],
    },
    media_manifest: {
      cover: (coverSource || legacyFallbackCover) ? { source_url: coverSource || legacyFallbackCover, role: "cover", selected: true } : null,
      gallery: gallery.map((entry) => pickMediaSourceUrl(entry)).filter(Boolean).map((source_url) => ({ source_url, role: "gallery", selected: true })),
      inline: inline.map((entry) => pickMediaSourceUrl(entry)).filter(Boolean).map((source_url) => ({ source_url, role: "inline", selected: true })),
    },
  };
}

function normalizeQueueItemShape(item) {
  const syntheticReviewSource = Number(item?.synthetic_review_source || 0) === 1 || item?.synthetic_review_source === true;
  return {
    ...item,
    synthetic_review_source: syntheticReviewSource,
    id: Number(item?.id || 0) || 0,
    review_id: Number(item?.review_id || item?.id || 0) || 0,
    entity_id: Number(item?.local_entity_id || item?.entity_id || 0) || 0,
    pending_type: item?.source_content_type === "event" ? "event" : "place",
    category: item?.source_content_type === "event" ? "event" : item?.category,
    review_content_id: Number(item?.review_content_id || 0) || null,
    review_content_status: item?.review_content_status ? String(item.review_content_status).trim().toLowerCase() : null,
    review_content_updated_at: item?.review_content_updated_at || null,
  };
}

function queueStatusFromReviewContentStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "published") return "approved";
  if (normalized === "rejected" || normalized === "needs_revision") return "rejected";
  return "pending";
}

function reviewDisplayId(item) {
  if (item?.synthetic_review_source && Number(item?.review_content_id || 0) > 0) {
    return Number(item.review_content_id || 0);
  }
  return Math.abs(Number(item?.review_id || 0) || 0);
}

function normalizeReviewContentDetailAsQueueItem(baseItem, reviewContent) {
  return normalizeQueueItemShape({
    ...baseItem,
    synthetic_review_source: true,
    review_content_id: Number(reviewContent?.id || 0) || 0,
    review_content_status: String(reviewContent?.status || "").trim().toLowerCase() || "pending_review",
    review_content_updated_at: reviewContent?.updated_at || null,
    review_status: queueStatusFromReviewContentStatus(reviewContent?.status),
    source_system: reviewContent?.source_system || baseItem?.source_system || "collector-app",
    source_content_type: reviewContent?.content_type || baseItem?.source_content_type || "place",
    source_content_item_id: Number(reviewContent?.source_content_item_id || baseItem?.source_content_item_id || 0) || 0,
    local_entity_id: Number(reviewContent?.public_entity_id || baseItem?.local_entity_id || baseItem?.entity_id || 0) || 0,
    entity_id: Number(reviewContent?.public_entity_id || baseItem?.entity_id || baseItem?.local_entity_id || 0) || 0,
    category: reviewContent?.content_type === "event" ? "event" : (reviewContent?.category || baseItem?.category || null),
    title: reviewContent?.title || baseItem?.title || "",
    description: reviewContent?.body || baseItem?.description || "",
    meta_title: reviewContent?.meta_title || baseItem?.meta_title || null,
    meta_description: reviewContent?.meta_description || baseItem?.meta_description || null,
    effective_cover_image: reviewContent?.effective_cover_image || reviewContent?.image || baseItem?.effective_cover_image || null,
    media_cover_image: reviewContent?.effective_cover_image || reviewContent?.image || baseItem?.media_cover_image || null,
    image: reviewContent?.effective_cover_image || reviewContent?.image || baseItem?.image || null,
    article_snapshot: {
      category: reviewContent?.content_type === "event" ? "event" : (reviewContent?.category || baseItem?.category || null),
      slug: reviewContent?.slug || null,
      title: reviewContent?.title || "",
      description: reviewContent?.body || "",
      excerpt: reviewContent?.excerpt || null,
      meta_title: reviewContent?.meta_title || null,
      meta_description: reviewContent?.meta_description || null,
      event_period_text: reviewContent?.event_period_text || null,
      location_text: reviewContent?.location_text || null,
      latitude: reviewContent?.latitude ?? null,
      longitude: reviewContent?.longitude ?? null,
      map_url: reviewContent?.map_url || null,
      google_place_id: reviewContent?.google_place_id || null,
      image: reviewContent?.effective_cover_image || reviewContent?.image || null,
    },
    confirmed_cta: {
      phone: reviewContent?.phone || null,
      line_url: reviewContent?.line_url || null,
      facebook_url: reviewContent?.facebook_url || null,
      website_url: reviewContent?.website_url || null,
      primary_cta: reviewContent?.primary_cta || null,
    },
    // Curation signal only, admin-session-only from the backend (never sent to the public review-access
    // token path) — see admin/PROJECT_POLICY.md: "Admin may review resolved taxonomy data and returned values."
    confirmed_taxonomy_checks: reviewContent?.confirmed_taxonomy_checks && typeof reviewContent.confirmed_taxonomy_checks === "object"
      ? reviewContent.confirmed_taxonomy_checks
      : {},
    history: Array.isArray(reviewContent?.history) ? reviewContent.history : [],
  });
}

const CONFIRMED_CTA_FIELDS = [
  ["phone", "เบอร์โทร"],
  ["line_url", "ลิงก์ LINE"],
  ["facebook_url", "ลิงก์ Facebook"],
  ["website_url", "ลิงก์เว็บไซต์"],
  ["primary_cta", "ปุ่มหลัก"],
];

// One compact line per card, not a full checklist — this is a curation signal for deciding how to
// present content, not a source of truth to audit (that lives in collector's Article Workspace).
function formatConfirmedTaxonomyChecksSummary(checks) {
  const entries = Object.entries(checks && typeof checks === "object" ? checks : {})
    .filter(([, value]) => value !== false && value != null && value !== "")
    .map(([key, value]) => {
      if (value === true) return key;
      if (Array.isArray(value)) return value.length ? `${key}: ${value.join(", ")}` : null;
      if (typeof value === "object") {
        const unit = value.unit ? ` ${value.unit}` : "";
        return `${key}: ${value.number ?? "-"}${unit}`;
      }
      return `${key}: ${value}`;
    })
    .filter(Boolean);
  return entries.length ? entries.join(", ") : null;
}

function canReusePendingReviewDraft(item) {
  const reviewContentId = Number(item?.review_content_id || 0) || 0;
  const reviewStatus = String(item?.review_content_status || "").trim().toLowerCase();
  if (!reviewContentId || reviewStatus !== "pending_review") return false;
  const queueUpdatedAt = Date.parse(String(item?.imported_at || item?.updated_at || item?.created_at || ""));
  const draftUpdatedAt = Date.parse(String(item?.review_content_updated_at || ""));
  if (Number.isFinite(queueUpdatedAt) && Number.isFinite(draftUpdatedAt) && draftUpdatedAt < queueUpdatedAt) {
    return false;
  }
  return true;
}

function pendingTypeLabel(item) {
  return item.pending_type === "event" ? "Event" : "Place";
}

function pendingCategoryLabel(item) {
  if (item.pending_type === "event") return "Event";
  return CATEGORY_LABEL[item.category] || item.category || "-";
}

function reviewStatusLabel(value) {
  const normalized = String(value || "pending").trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "rejected") return "Rejected";
  if (normalized === "deleted") return "Deleted";
  return "Pending";
}

function sourceSystemLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "collector-app") return "Collector";
  if (!normalized) return "-";
  return value;
}

function actionTypeLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "imported") return "Imported";
  if (normalized === "reimported") return "Re-imported";
  if (normalized === "approved") return "Approved";
  if (normalized === "rejected") return "Rejected";
  if (normalized === "needs_revision") return "Needs revision";
  return value || "-";
}

function formatDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function buildReviewRouteUrl(item) {
  const reviewId = Number(item?.review_id || 0) || 0;
  const lang = String(item?.lang || item?.source_lang || "th").trim().toLowerCase() || "th";
  const frontendBase = resolveFrontendBaseUrl();
  if (!reviewId) return "";
  if (!frontendBase) return "";
  return `${frontendBase}/${encodeURIComponent(lang)}/review/${encodeURIComponent(reviewId)}`;
}

function submitReviewSessionWindow({ reviewId, lang, accessToken, expiresIn }) {
  const frontendBase = resolveFrontendBaseUrl();
  if (!frontendBase) {
    throw new Error("VITE_FRONTEND_URL is not configured for this origin");
  }
  const action = `${frontendBase}/api/review-session`;
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.target = "_blank";
  form.style.display = "none";

  const fields = { review_id: String(reviewId || ""), lang: String(lang || "th"), access_token: String(accessToken || ""), expires_in: String(expiresIn || "") };
  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

function storeDeleteContentTarget(conflict) {
  try {
    window.sessionStorage.setItem(DELETE_CONTENT_TARGET_STORAGE_KEY, JSON.stringify(conflict || {}));
  } catch {
    // ignore session storage failures and still allow navigation
  }
}

export default function Approvals({ token, onPendingChanged, onNavigate }) {
  const [activeTab, setActiveTab] = useState("pending");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("all");
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [items, setItems] = useState([]);
  const [statusCounts, setStatusCounts] = useState({ pending: 0, approved: 0, rejected: 0, all: 0 });
  const [statusTypeCounts, setStatusTypeCounts] = useState({
    pending: { all: 0, place: 0, event: 0 },
    approved: { all: 0, place: 0, event: 0 },
    rejected: { all: 0, place: 0, event: 0 },
    deleted: { all: 0, place: 0, event: 0 },
  });
  const [loading, setLoading] = useState(false);
  const [approvingId, setApprovingId] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState(null);
  const [approvalLogs, setApprovalLogs] = useState([]);
  const [expandedReviewId, setExpandedReviewId] = useState(null);
  const [expandedLoadingId, setExpandedLoadingId] = useState(0);
  const [detailMap, setDetailMap] = useState({});
  const [reviewNotes, setReviewNotes] = useState({});
  const [historyOpenMap, setHistoryOpenMap] = useState({});
  const [rejectConfirm, setRejectConfirm] = useState(null);
  const queueRequestSeqRef = useRef(0);

  const summarizeByStatusAndType = useCallback((queueItems) => {
    const summary = {
      pending: { all: 0, place: 0, event: 0 },
      approved: { all: 0, place: 0, event: 0 },
      rejected: { all: 0, place: 0, event: 0 },
      deleted: { all: 0, place: 0, event: 0 },
    };
    for (const item of Array.isArray(queueItems) ? queueItems : []) {
      const status = String(item?.review_status || "").trim().toLowerCase();
      const type = String(item?.pending_type || "").trim().toLowerCase() === "event" ? "event" : "place";
      if (!Object.prototype.hasOwnProperty.call(summary, status)) continue;
      summary[status].all += 1;
      summary[status][type] += 1;
    }
    return summary;
  }, []);

  const mergeQueueItem = useCallback((targetReviewId, patch) => {
    const normalizedReviewId = Number(targetReviewId || 0) || 0;
    if (!normalizedReviewId) return;
    setItems((current) => current.map((entry) => (entry.review_id === normalizedReviewId ? normalizeQueueItemShape({ ...entry, ...patch }) : entry)));
    setDetailMap((current) => {
      const found = current[normalizedReviewId];
      if (!found) return current;
      return { ...current, [normalizedReviewId]: normalizeQueueItemShape({ ...found, ...patch }) };
    });
  }, []);

  const removeQueueItemAfterDecision = useCallback((item, nextStatus) => {
    const normalizedNextStatus = String(nextStatus || "").trim().toLowerCase();
    setItems((current) => current.filter((entry) => entry.review_id !== item.review_id));
    setDetailMap((current) => {
      const next = { ...current };
      delete next[item.review_id];
      return next;
    });
    setReviewNotes((current) => {
      const next = { ...current };
      delete next[item.review_id];
      return next;
    });
    setHistoryOpenMap((current) => {
      const next = { ...current };
      delete next[item.review_id];
      return next;
    });
    if (expandedReviewId === item.review_id) setExpandedReviewId(null);

    let nextPendingCount = 0;
    setStatusCounts((current) => {
      nextPendingCount = Math.max(0, Number(current.pending || 0) - 1);
      return {
        ...current,
        pending: nextPendingCount,
        approved: normalizedNextStatus === "approved" ? Number(current.approved || 0) + 1 : Number(current.approved || 0),
        rejected: normalizedNextStatus === "rejected" ? Number(current.rejected || 0) + 1 : Number(current.rejected || 0),
      };
    });
    setStatusTypeCounts((current) => ({
      ...current,
      pending: {
        ...current.pending,
        all: Math.max(0, Number(current.pending?.all || 0) - 1),
        [item.pending_type]: Math.max(0, Number(current.pending?.[item.pending_type] || 0) - 1),
      },
      approved: normalizedNextStatus === "approved"
        ? { ...current.approved, all: Number(current.approved?.all || 0) + 1, [item.pending_type]: Number(current.approved?.[item.pending_type] || 0) + 1 }
        : current.approved,
      rejected: normalizedNextStatus === "rejected"
        ? { ...current.rejected, all: Number(current.rejected?.all || 0) + 1, [item.pending_type]: Number(current.rejected?.[item.pending_type] || 0) + 1 }
        : current.rejected,
    }));
    onPendingChanged?.(nextPendingCount);
  }, [expandedReviewId, onPendingChanged]);

  const loadPending = useCallback(async () => {
    const requestSeq = queueRequestSeqRef.current + 1;
    queueRequestSeqRef.current = requestSeq;
    setLoading(true);
    setMessage("");
    setApprovalLogs([]);

    try {
      const headers = authHeaders(token);
      const baseParams = {
        source_system: "collector-app",
        search: searchText,
        limit: 200,
        offset: 0,
      };

      const fetchByStatus = async (status) =>
        api.get("/collector-import-reviews", {
          params: { ...baseParams, status },
          headers,
        });

      let res;
      let queueItems = [];
      if (activeTab === "pending") {
        res = await fetchByStatus("pending");
        queueItems = (Array.isArray(res.data?.items) ? res.data.items : []).map((item) => normalizeQueueItemShape(item));
      } else if (historyStatusFilter === "approved") {
        res = await fetchByStatus("approved");
        queueItems = (Array.isArray(res.data?.items) ? res.data.items : []).map((item) => normalizeQueueItemShape(item));
      } else if (historyStatusFilter === "rejected") {
        res = await fetchByStatus("rejected");
        queueItems = (Array.isArray(res.data?.items) ? res.data.items : []).map((item) => normalizeQueueItemShape(item));
      } else if (historyStatusFilter === "deleted") {
        res = await api.get("/collector-import-reviews-deleted", {
          params: { limit: 200, offset: 0 },
          headers,
        });
        queueItems = (Array.isArray(res.data?.items) ? res.data.items : []).map((item) => normalizeQueueItemShape(item));
      } else {
        const [approvedRes, rejectedRes, deletedRes] = await Promise.all([
          fetchByStatus("approved"),
          fetchByStatus("rejected"),
          api.get("/collector-import-reviews-deleted", {
            params: { limit: 200, offset: 0 },
            headers,
          }),
        ]);
        res = approvedRes;
        const approvedItems = (Array.isArray(approvedRes.data?.items) ? approvedRes.data.items : []).map((item) => normalizeQueueItemShape(item));
        const rejectedItems = (Array.isArray(rejectedRes.data?.items) ? rejectedRes.data.items : []).map((item) => normalizeQueueItemShape(item));
        const deletedItems = (Array.isArray(deletedRes.data?.items) ? deletedRes.data.items : []).map((item) => normalizeQueueItemShape(item));
        queueItems = [...approvedItems, ...rejectedItems, ...deletedItems].sort((a, b) => {
          const at = Date.parse(String(a?.imported_at || a?.updated_at || a?.created_at || ""));
          const bt = Date.parse(String(b?.imported_at || b?.updated_at || b?.created_at || ""));
          if (Number.isFinite(at) && Number.isFinite(bt)) return bt - at;
          return Number(b?.review_id || 0) - Number(a?.review_id || 0);
        });
      }

      if (queueRequestSeqRef.current !== requestSeq) return;
      setItems(queueItems);
      setExpandedReviewId(null);
      setDetailMap({});
      setReviewNotes({});
      setHistoryOpenMap({});

      if (activeTab === "pending") {
        const nextCounts = {
          pending: Number(res.data?.status_counts?.pending || 0) || 0,
          approved: Number(res.data?.status_counts?.approved || 0) || 0,
          rejected: Number(res.data?.status_counts?.rejected || 0) || 0,
          all: Number(res.data?.status_counts?.all || 0) || 0,
        };
        setStatusCounts(nextCounts);
        setStatusTypeCounts({
          pending: { all: Number(res.data?.status_type_counts?.pending?.all || 0), place: Number(res.data?.status_type_counts?.pending?.place || 0), event: Number(res.data?.status_type_counts?.pending?.event || 0) },
          approved: { all: Number(res.data?.status_type_counts?.approved?.all || 0), place: Number(res.data?.status_type_counts?.approved?.place || 0), event: Number(res.data?.status_type_counts?.approved?.event || 0) },
          rejected: { all: Number(res.data?.status_type_counts?.rejected?.all || 0), place: Number(res.data?.status_type_counts?.rejected?.place || 0), event: Number(res.data?.status_type_counts?.rejected?.event || 0) },
          deleted: { all: 0, place: 0, event: 0 },
        });
        onPendingChanged?.(nextCounts.pending);
      } else {
        const nextTypeCounts = summarizeByStatusAndType(queueItems);
        setStatusTypeCounts(nextTypeCounts);
        setStatusCounts((current) => ({
          ...current,
          approved: nextTypeCounts.approved.all,
          rejected: nextTypeCounts.rejected.all,
          all: nextTypeCounts.approved.all + nextTypeCounts.rejected.all + nextTypeCounts.deleted.all,
        }));
      }
    } catch (err) {
      if (queueRequestSeqRef.current !== requestSeq) return;
      setMessage(err?.response?.data?.error || err?.message || "Failed to load final review queue");
    } finally {
      if (queueRequestSeqRef.current === requestSeq) setLoading(false);
    }
  }, [activeTab, historyStatusFilter, onPendingChanged, searchText, summarizeByStatusAndType, token]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  const tabItems = useMemo(() => {
    if (activeTab === "pending") return items.filter((item) => String(item.review_status || "").trim().toLowerCase() === "pending");
    const base = items.filter((item) => {
      const status = String(item.review_status || "").trim().toLowerCase();
      return status === "approved" || status === "rejected" || status === "deleted";
    });
    if (historyStatusFilter === "approved") return base.filter((item) => String(item.review_status || "").trim().toLowerCase() === "approved");
    if (historyStatusFilter === "rejected") return base.filter((item) => String(item.review_status || "").trim().toLowerCase() === "rejected");
    if (historyStatusFilter === "deleted") return base.filter((item) => String(item.review_status || "").trim().toLowerCase() === "deleted");
    return base;
  }, [activeTab, historyStatusFilter, items]);

  const filteredItems = useMemo(
    () =>
      tabItems.filter((item) => {
        if (typeFilter === "event" && item.pending_type !== "event") return false;
        if (typeFilter === "place" && item.pending_type !== "place") return false;
        if (filter === "all") return true;
        if (filter === "event") return item.pending_type === "event";
        return item.pending_type === "place" && item.category === filter;
      }),
    [tabItems, filter, typeFilter]
  );

  const queueSummary = useMemo(() => {
    let counts;
    if (activeTab === "pending") {
      counts = statusTypeCounts.pending || { all: 0, place: 0, event: 0 };
    } else if (historyStatusFilter === "approved") {
      counts = statusTypeCounts.approved || { all: 0, place: 0, event: 0 };
    } else if (historyStatusFilter === "rejected") {
      counts = statusTypeCounts.rejected || { all: 0, place: 0, event: 0 };
    } else if (historyStatusFilter === "deleted") {
      counts = statusTypeCounts.deleted || { all: 0, place: 0, event: 0 };
    } else {
      counts = {
        all: Number(statusTypeCounts.approved?.all || 0) + Number(statusTypeCounts.rejected?.all || 0) + Number(statusTypeCounts.deleted?.all || 0),
        place: Number(statusTypeCounts.approved?.place || 0) + Number(statusTypeCounts.rejected?.place || 0) + Number(statusTypeCounts.deleted?.place || 0),
        event: Number(statusTypeCounts.approved?.event || 0) + Number(statusTypeCounts.rejected?.event || 0) + Number(statusTypeCounts.deleted?.event || 0),
      };
    }
    return { total: Number(counts.all || 0), placeCount: Number(counts.place || 0), eventCount: Number(counts.event || 0) };
  }, [activeTab, historyStatusFilter, statusTypeCounts]);

  const statusMeta = useMemo(() => {
    if (activeTab === "history") return { title: "Final Review History", description: "Approved/rejected items for audit and traceability.", empty: "No history items match the current filters." };
    return { title: "Final Review Queue", description: "Collector imports waiting for final decision.", empty: "No pending items match the current filters." };
  }, [activeTab]);

  const loadRowDetail = useCallback(async (item) => {
    const reviewId = Number(item?.review_id || 0) || 0;
    setExpandedLoadingId(reviewId);
    try {
      let detailItem;
      if (item?.synthetic_review_source && Number(item?.review_content_id || 0) > 0) {
        const res = await api.get(`/review-content/${item.review_content_id}`, { headers: authHeaders(token) });
        detailItem = normalizeReviewContentDetailAsQueueItem(item, res?.data?.item || {});
      } else {
        const res = await api.get(`/collector-import-reviews/${Math.abs(reviewId)}`, { headers: authHeaders(token) });
        detailItem = normalizeQueueItemShape(res?.data?.item || {});
      }
      setDetailMap((current) => ({ ...current, [reviewId]: detailItem }));
      setReviewNotes((current) => (current[reviewId] != null ? current : { ...current, [reviewId]: String(detailItem?.review_note || "").trim() }));
      mergeQueueItem(reviewId, detailItem);
    } catch (err) {
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to load review detail";
      setMessage(errorMessage);
      setNotice({ type: "error", text: errorMessage });
    } finally {
      setExpandedLoadingId(0);
    }
  }, [mergeQueueItem, token]);

  const toggleRowExpanded = useCallback((item) => {
    if (expandedReviewId === item.review_id) {
      setExpandedReviewId(null);
      return;
    }
    setExpandedReviewId(item.review_id);
    setHistoryOpenMap((current) => ({ ...current, [item.review_id]: false }));
    if (!detailMap[item.review_id]) {
      loadRowDetail(item);
    }
  }, [detailMap, expandedReviewId, loadRowDetail]);

  async function ensureReviewContentDraft(item, options = {}) {
    const forceRefresh = options?.forceRefresh === true;
    const allowAnyExistingReviewContent = options?.allowAnyExistingReviewContent === true;
    const existingDetail = detailMap[item.review_id];
    let detail = existingDetail ? normalizeQueueItemShape({ ...item, ...existingDetail }) : item;

    if (!forceRefresh && allowAnyExistingReviewContent && Number(detail?.review_content_id || 0) > 0) {
      return { reviewContentId: Number(detail.review_content_id || 0) || 0 };
    }
    if (!forceRefresh && canReusePendingReviewDraft(detail)) {
      return { reviewContentId: Number(detail.review_content_id || 0) || 0 };
    }
    if (!detail?.article_snapshot) {
      if (item?.synthetic_review_source && Number(item?.review_content_id || 0) > 0) {
        const res = await api.get(`/review-content/${item.review_content_id}`, { headers: authHeaders(token) });
        if (res?.data?.item) {
          detail = normalizeReviewContentDetailAsQueueItem(item, res.data.item);
          setDetailMap((current) => ({ ...current, [item.review_id]: detail }));
          mergeQueueItem(item.review_id, detail);
        }
      } else {
        const res = await api.get(`/collector-import-reviews/${Math.abs(item.review_id)}`, { headers: authHeaders(token) });
        if (res?.data?.item) {
          detail = normalizeQueueItemShape({ ...item, ...res.data.item });
          setDetailMap((current) => ({ ...current, [item.review_id]: detail }));
          mergeQueueItem(item.review_id, detail);
        }
      }
    }
    if (!forceRefresh && allowAnyExistingReviewContent && Number(detail?.review_content_id || 0) > 0) {
      return { reviewContentId: Number(detail.review_content_id || 0) || 0 };
    }
    if (!forceRefresh && canReusePendingReviewDraft(detail)) {
      return { reviewContentId: Number(detail.review_content_id || 0) || 0 };
    }
    const payload = buildReviewIngestPayload(detail);
    if (!payload.source_content_item_id || !payload.content.title || !payload.content.body) {
      throw new Error("Incomplete review payload");
    }
    const ingestRes = await api.post("/review-content/ingest", payload, { headers: authHeaders(token) });
    const reviewItem = ingestRes?.data?.item;
    const reviewId = Number(reviewItem?.id || 0) || 0;
    if (!reviewId) throw new Error("Review draft ingest failed");
    const patch = {
      review_content_id: reviewId,
      review_content_status: String(reviewItem?.status || "pending_review").trim().toLowerCase(),
      review_content_updated_at: new Date().toISOString(),
    };
    mergeQueueItem(item.review_id, patch);
    setDetailMap((current) => ({ ...current, [item.review_id]: normalizeQueueItemShape({ ...(current[item.review_id] || item), ...patch }) }));
    return { reviewContentId: reviewId };
  }

  async function openReviewPage(item) {
    setMessage("");
    try {
      const draft = await ensureReviewContentDraft(item, {
        allowAnyExistingReviewContent: activeTab !== "pending",
      });
      const accessRes = await api.post(`/review-content/${draft.reviewContentId}/access-token`, {}, { headers: authHeaders(token) });
      const accessToken = String(accessRes?.data?.access_token || "").trim();
      const expiresIn = Number(accessRes?.data?.expires_in || 0) || 0;
      const routeUrl = buildReviewRouteUrl({ review_id: draft.reviewContentId, lang: item?.source_lang || "th", source_lang: item?.source_lang || "th" });
      if (!routeUrl || !accessToken) throw new Error("Cannot create review access session");
      submitReviewSessionWindow({ reviewId: draft.reviewContentId, lang: item?.source_lang || "th", accessToken, expiresIn });
    } catch (err) {
      const errorMessage = err?.response?.data?.error || err?.message || "Cannot open review page";
      setMessage(errorMessage);
      setNotice({ type: "error", text: errorMessage });
    }
  }

  async function onApprove(item) {
    const key = `approve-${item.pending_type}-${item.review_id}`;
    setApprovingId(key);
    setMessage("");
    setApprovalLogs([]);
    try {
      const draft = await ensureReviewContentDraft(item);
      const reviewContentId = draft.reviewContentId;
      const reviewNote = String(reviewNotes[item.review_id] || "").trim();
      const res = await api.post(`/review-content/${reviewContentId}/approve`, { review_note: reviewNote }, { headers: authHeaders(token) });
      const resultItem = res?.data?.item || {};
      setNotice({ type: "success", text: `Approved review ID ${item.review_id}.`, conflict: null });
      setApprovalLogs([`review_id=${item.review_id}`, `review_content_id=${reviewContentId}`, `status=${resultItem.status || "published"}`, resultItem.slug ? `slug=${resultItem.slug}` : "slug=-"]);
      removeQueueItemAfterDecision(item, "approved");
    } catch (err) {
      const emerConflict = err?.response?.data?.error === "emer_conflict" ? err?.response?.data?.conflict : null;
      const conflictHint = emerConflict
        ? `Emergency content exists (#${emerConflict.entity_id}${emerConflict.slug ? `, slug: ${emerConflict.slug}` : ""}). Purge it first.`
        : "";
      const errorMessage = conflictHint || err?.response?.data?.error || err?.message || "Approve failed";
      setMessage(errorMessage);
      setNotice({ type: "error", text: `Approve failed: ${errorMessage}`, conflict: emerConflict });
      setApprovalLogs(Array.isArray(err?.response?.data?.logs) ? err.response.data.logs : []);
    } finally {
      setApprovingId("");
    }
  }

  async function onNeedsRevision(item) {
    const key = `needs-${item.pending_type}-${item.review_id}`;
    setApprovingId(key);
    setMessage("");
    setApprovalLogs([]);
    const reviewNote = String(reviewNotes[item.review_id] || "").trim();
    try {
      let draft = null;
      try {
        draft = await ensureReviewContentDraft(item);
      } catch (draftError) {
        if (!isLegacyReviewItem({ ...item, ...(detailMap[item.review_id] || {}) })) throw draftError;
        const fallbackRes = await api.post("/review-content/legacy-needs-revision", { review_id: item.review_id, review_note: reviewNote }, { headers: authHeaders(token) });
      setNotice({ type: "success", text: `Returned legacy review ID ${item.review_id} for revision.`, conflict: null });
        setApprovalLogs([`review_id=${item.review_id}`, "flow=legacy_needs_revision_fallback", `status=${fallbackRes?.data?.item?.status || "rejected"}`]);
        removeQueueItemAfterDecision(item, "rejected");
        return;
      }
      const reviewContentId = draft.reviewContentId;
      const res = await api.post(`/review-content/${reviewContentId}/needs-revision`, { review_note: reviewNote }, { headers: authHeaders(token) });
      setNotice({ type: "success", text: `Returned review ID ${item.review_id} for revision.`, conflict: null });
      setApprovalLogs([`review_id=${item.review_id}`, `review_content_id=${reviewContentId}`, `status=${res?.data?.item?.status || "needs_revision"}`]);
      removeQueueItemAfterDecision(item, "rejected");
    } catch (err) {
      const errorMessage = err?.response?.data?.error || err?.message || "Needs revision failed";
      setMessage(errorMessage);
      setNotice({ type: "error", text: `Needs revision failed: ${errorMessage}`, conflict: null });
      setApprovalLogs(Array.isArray(err?.response?.data?.logs) ? err.response.data.logs : []);
    } finally {
      setApprovingId("");
    }
  }

  async function onReject(item) {
    const key = `reject-${item.pending_type}-${item.review_id}`;
    setApprovingId(key);
    setMessage("");
    setApprovalLogs([]);
    const reviewNote = String(reviewNotes[item.review_id] || "").trim();
    try {
      let draft = null;
      try {
        draft = await ensureReviewContentDraft(item);
      } catch (draftError) {
        if (!isLegacyReviewItem({ ...item, ...(detailMap[item.review_id] || {}) })) throw draftError;
        const fallbackRes = await api.post("/review-content/legacy-reject", { review_id: item.review_id, review_note: reviewNote }, { headers: authHeaders(token) });
        setNotice({ type: "success", text: `Rejected legacy review ID ${item.review_id}.`, conflict: null });
        setApprovalLogs([`review_id=${item.review_id}`, "flow=legacy_reject_fallback", `status=${fallbackRes?.data?.item?.status || "rejected"}`]);
        removeQueueItemAfterDecision(item, "rejected");
        return;
      }
      const reviewContentId = draft.reviewContentId;
      const res = await api.post(`/review-content/${reviewContentId}/reject`, { review_note: reviewNote }, { headers: authHeaders(token) });
      setNotice({ type: "success", text: `Rejected review ID ${item.review_id}.`, conflict: null });
      setApprovalLogs([`review_id=${item.review_id}`, `review_content_id=${reviewContentId}`, `status=${res?.data?.item?.status || "rejected"}`, "terminal=true"]);
      removeQueueItemAfterDecision(item, "rejected");
    } catch (err) {
      const errorMessage = err?.response?.data?.error || err?.message || "Reject failed";
      setMessage(errorMessage);
      setNotice({ type: "error", text: `Reject failed: ${errorMessage}`, conflict: null });
      setApprovalLogs(Array.isArray(err?.response?.data?.logs) ? err.response.data.logs : []);
    } finally {
      setApprovingId("");
    }
  }

  return (
    <>
      {notice ? (
        <div className="notice-backdrop" onClick={() => setNotice(null)}>
          <div className={`notice-card ${notice.type}`} onClick={(e) => e.stopPropagation()}>
            <div className="card-title-row">
              <h2>{notice.type === "success" ? "Review updated" : "Action failed"}</h2>
              <button type="button" className="ghost" onClick={() => setNotice(null)}>Close</button>
            </div>
            <p className="notice-text">{notice.text}</p>
            {notice.type === "error" && notice.conflict ? (
              <div className="actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    storeDeleteContentTarget(notice.conflict);
                    setNotice(null);
                    onNavigate?.("/dashboard/delete-content");
                  }}
                >
                  Open Delete Content
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setNotice(null);
                    onNavigate?.("/dashboard/emergency");
                  }}
                >
                  Open Emergency
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {rejectConfirm ? (
        <div className="notice-backdrop" onClick={() => setRejectConfirm(null)}>
          <div className="notice-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-title-row">
              <h2>Confirm reject</h2>
            </div>
            <p className="notice-text">This is a terminal reject and will clear backend review data. Continue?</p>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => setRejectConfirm(null)}>Cancel</button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const target = rejectConfirm;
                  setRejectConfirm(null);
                  onReject(target);
                }}
              >
                Confirm reject
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="admin-card approvals-surface-card">
        <div className="card-title-row approvals-surface-head">
          <div className="approvals-surface-heading">
            <span className="approvals-surface-kicker">Admin Final Review</span>
            <h2>{statusMeta.title}</h2>
            <p className="muted approvals-surface-description">{statusMeta.description}</p>
          </div>
          <div className="approvals-surface-actions">
            <button type="button" className="ghost" onClick={loadPending} disabled={loading}>{loading ? "Loading..." : "Reload queue"}</button>
          </div>
        </div>

        <div className="approvals-tab-row">
          <button type="button" className={activeTab === "pending" ? "primary" : "ghost"} onClick={() => setActiveTab("pending")}>Pending ({statusCounts.pending})</button>
          <button type="button" className={activeTab === "history" ? "primary" : "ghost"} onClick={() => setActiveTab("history")}>History</button>
        </div>

        <div className="approvals-summary-grid">
          <div className="approvals-summary-card approvals-summary-card-primary"><p className="approvals-summary-kicker">{activeTab === "pending" ? "Pending" : (historyStatusFilter === "all" ? "History" : reviewStatusLabel(historyStatusFilter))}</p><strong>{queueSummary.total}</strong></div>
          <div className="approvals-summary-card"><p className="approvals-summary-kicker">Places</p><strong>{queueSummary.placeCount}</strong></div>
          <div className="approvals-summary-card"><p className="approvals-summary-kicker">Events</p><strong>{queueSummary.eventCount}</strong></div>
        </div>

        {activeTab === "history" ? (
          <div className="approvals-tab-row" style={{ marginTop: 10 }}>
            <button type="button" className={historyStatusFilter === "all" ? "primary" : "ghost"} onClick={() => setHistoryStatusFilter("all")}>All</button>
            <button type="button" className={historyStatusFilter === "approved" ? "primary" : "ghost"} onClick={() => setHistoryStatusFilter("approved")}>Approved</button>
            <button type="button" className={historyStatusFilter === "rejected" ? "primary" : "ghost"} onClick={() => setHistoryStatusFilter("rejected")}>Rejected</button>
            <button type="button" className={historyStatusFilter === "deleted" ? "primary" : "ghost"} onClick={() => setHistoryStatusFilter("deleted")}>Deleted</button>
          </div>
        ) : null}

        <div className="approvals-filter-bar">
          <div className="approvals-filter-grid">
            <label className="approvals-filter-field"><span>Type</span><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="all">All types</option><option value="place">Places</option><option value="event">Events</option></select></label>
            <label className="approvals-filter-field approvals-filter-field-wide"><span>Search</span><input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search review ID, source item ID, or title" /></label>
            <label className="approvals-filter-field"><span>Category</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All categories</option><option value="event">Events</option>{CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>)}</select></label>
            <div className="approvals-filter-stat" aria-live="polite"><span>Visible items</span><strong>{filteredItems.length}</strong></div>
          </div>
        </div>

        {filteredItems.length === 0 ? <p className="muted">{statusMeta.empty}</p> : activeTab === "history" ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Review ID</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Title</th>
                  <th>Source Item</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={`${item.pending_type}-${item.review_id}`}>
                    <td>#{reviewDisplayId(item)}</td>
                    <td>{reviewStatusLabel(item.review_status)}</td>
                    <td>{pendingTypeLabel(item)}</td>
                    <td>{item.title || "(Untitled)"}</td>
                    <td>{item.source_content_item_id || "-"}</td>
                    <td>{formatDateTime(item.updated_at || item.imported_at || item.reviewed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="approvals-queue-list">
            {filteredItems.map((item) => {
              const isExpanded = expandedReviewId === item.review_id;
              const detail = detailMap[item.review_id] || item;
              const note = reviewNotes[item.review_id] || "";
              const historyOpen = Boolean(historyOpenMap[item.review_id]);
              const busyApprove = approvingId === `approve-${item.pending_type}-${item.review_id}`;
              const busyNeeds = approvingId === `needs-${item.pending_type}-${item.review_id}`;
              const busyReject = approvingId === `reject-${item.pending_type}-${item.review_id}`;
              const history = Array.isArray(detail?.history) ? detail.history : [];

              return (
                <article key={`${item.pending_type}-${item.review_id}`} className="approvals-queue-card">
                  <div className="approvals-queue-head" onClick={() => toggleRowExpanded(item)} style={{ cursor: "pointer" }}>
                    <div>
                      <div className="approvals-chip-row">
                        <span className="approvals-chip">{pendingTypeLabel(item)}</span>
                        <span className="approvals-chip subtle">{pendingCategoryLabel(item)}</span>
                        <span className="approvals-chip subtle">Review #{reviewDisplayId(item)}</span>
                        <span className={`approvals-chip status-${item.review_status || "pending"}`}>{reviewStatusLabel(item.review_status)}</span>
                      </div>
                      <h3>{item.title || "(Untitled)"}</h3>
                      <p className="muted approvals-queue-copy">Imported from {sourceSystemLabel(item.source_system)} | Source item {item.source_content_item_id || "-"} | Entity {item.entity_id || "-"}</p>
                    </div>
                    <div className="approvals-queue-actions" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="approvals-open-review-btn" onClick={() => openReviewPage(item)}>Open Public Preview</button>
                      <button type="button" className="approvals-toggle-detail-btn" onClick={() => toggleRowExpanded(item)}>{isExpanded ? "Hide Actions" : "Open Actions"}</button>
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="approvals-inline-panel">
                      {expandedLoadingId === item.review_id ? <p className="muted">Loading detail...</p> : null}
                      <div className="approvals-preview-alert warning">
                        Decision panel only. Use Open Review Page to inspect real rendered output.
                      </div>
                      <p className="muted">Review ID {detail.review_id || "-"} | Source {detail.source_content_item_id || "-"} | {pendingTypeLabel(detail)} / {pendingCategoryLabel(detail)}</p>
                      {detail.pending_type === "place" ? (
                        <div className="approvals-history-item">
                          <div className="approvals-history-head"><strong>CTA / ข้อมูลติดต่อ — ยืนยันจาก collector</strong></div>
                          {CONFIRMED_CTA_FIELDS.map(([key, label]) => (
                            <p key={key} className="muted">{label}: {detail.confirmed_cta?.[key] || "-"}</p>
                          ))}
                          <p className="muted">Taxonomy: {formatConfirmedTaxonomyChecksSummary(detail.confirmed_taxonomy_checks) || "-"}</p>
                        </div>
                      ) : null}
                      <label style={{ display: "block", marginBottom: 6 }}>Decision note</label>
                      <textarea rows={3} value={note} onChange={(e) => setReviewNotes((current) => ({ ...current, [item.review_id]: e.target.value }))} placeholder="Add decision note" readOnly={activeTab !== "pending"} />
                      <div style={{ marginTop: 10 }}>
                        <button type="button" className="ghost" onClick={() => setHistoryOpenMap((current) => ({ ...current, [item.review_id]: !historyOpen }))}>
                          {historyOpen ? "Hide history" : "Show history"}
                        </button>
                      </div>
                      {historyOpen ? (
                        history.length ? (
                          <div className="approvals-history-list" style={{ marginTop: 10 }}>
                            {history.map((entry) => (
                              <div key={entry.id} className="approvals-history-item">
                                <div className="approvals-history-head"><strong>{actionTypeLabel(entry.action_type)}</strong><span>{formatDateTime(entry.created_at)}</span></div>
                                <p className="muted" style={{ margin: "4px 0 0" }}>{entry.previous_status || "-"} to {entry.next_status || "-"}</p>
                                {entry.review_note ? <p style={{ margin: "6px 0 0" }}>{entry.review_note}</p> : null}
                              </div>
                            ))}
                          </div>
                        ) : <p className="muted" style={{ marginTop: 10 }}>No review history yet.</p>
                      ) : null}

                      {activeTab === "pending" ? (
                        <div className="actions approvals-decision-bar" style={{ marginTop: 12 }}>
                          <button type="button" className="primary" disabled={busyApprove} onClick={() => onApprove(item)}>{busyApprove ? "Approving..." : "Approve"}</button>
                          <button type="button" className="ghost" disabled={busyNeeds} onClick={() => onNeedsRevision(item)}>{busyNeeds ? "Sending..." : "Needs revision"}</button>
                          <button type="button" className="danger" disabled={busyReject} onClick={() => setRejectConfirm(item)}>{busyReject ? "Rejecting..." : "Reject"}</button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
        {message ? <p className="status">{message}</p> : null}
      </section>

      <section className="admin-card">
        <div className="card-title-row">
          <div>
            <h2>Decision Logs</h2>
            <p className="muted approvals-log-description">Latest output from decision actions in final review.</p>
          </div>
        </div>
        {approvalLogs.length ? (
          <pre style={{ whiteSpace: "pre-wrap", margin: 0, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--theme-border)", background: "var(--theme-surface)", fontSize: 12, lineHeight: 1.55, maxHeight: 260, overflow: "auto" }}>
            {approvalLogs.map((line, idx) => `${idx + 1}. ${line}`).join("\n")}
          </pre>
        ) : <p className="muted">No logs yet.</p>}
      </section>
    </>
  );
}
