import { useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../api/api";

const RANGE_OPTIONS = [7, 30, 90];

function normalizeCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function formatDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function buildMissingLabel(missing = []) {
  const list = Array.isArray(missing) ? missing : [];
  if (!list.length) return "Complete";
  return list.map((entry) => String(entry || "").trim()).filter(Boolean).join(", ");
}

export default function CtaAnalytics({ token }) {
  const [rangeDays, setRangeDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [topEntities, setTopEntities] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);
  const [missingCta, setMissingCta] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const headers = authHeaders(token);
        const [summaryRes, topRes, recentRes, missingRes] = await Promise.all([
          api.get("/analytics/cta-summary", { params: { range_days: rangeDays }, headers }),
          api.get("/analytics/top-entities", { params: { range_days: rangeDays, limit: 10 }, headers }),
          api.get("/analytics/recent-events", { params: { limit: 50 }, headers }),
          api.get("/analytics/missing-cta", { params: { limit: 50 }, headers }),
        ]);
        if (cancelled) return;
        setSummary(summaryRes?.data || null);
        setTopEntities(Array.isArray(topRes?.data?.items) ? topRes.data.items : []);
        setRecentEvents(Array.isArray(recentRes?.data?.items) ? recentRes.data.items : []);
        setMissingCta(Array.isArray(missingRes?.data?.items) ? missingRes.data.items : []);
      } catch (err) {
        if (cancelled) return;
        const message = err?.response?.data?.error || err?.message || "Failed to load CTA analytics";
        setError(String(message));
        setSummary(null);
        setTopEntities([]);
        setRecentEvents([]);
        setMissingCta([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [rangeDays, token]);

  const metrics = useMemo(() => {
    const byType = summary?.by_type || {};
    return {
      total: normalizeCount(summary?.total_clicks),
      map: normalizeCount(byType?.MAP_CLICK),
      phone: normalizeCount(byType?.PHONE_CLICK),
      line: normalizeCount(byType?.LINE_CLICK),
    };
  }, [summary]);

  return (
    <section className="admin-card cta-analytics-card">
      <div className="card-title-row cta-analytics-head">
        <div>
          <h2>CTA &amp; Analytics</h2>
          <p className="muted cta-analytics-subtitle">Operational click tracking for approved content</p>
        </div>
        <label className="cta-range-control">
          <span>Range</span>
          <select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value) || 30)}>
            {RANGE_OPTIONS.map((days) => (
              <option key={days} value={days}>{days} days</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="cta-state-card cta-state-loading">Loading CTA analytics...</div>
      ) : null}

      {!loading && error ? (
        <div className="cta-state-card cta-state-error">
          <p>Unable to load analytics data.</p>
          <p className="muted">{error}</p>
        </div>
      ) : null}

      {!loading && !error ? (
        <>
          <div className="cta-metric-grid">
            <article className="cta-metric-card">
              <p>Total CTA Clicks</p>
              <strong>{metrics.total}</strong>
            </article>
            <article className="cta-metric-card">
              <p>Map Clicks</p>
              <strong>{metrics.map}</strong>
            </article>
            <article className="cta-metric-card">
              <p>Phone Clicks</p>
              <strong>{metrics.phone}</strong>
            </article>
            <article className="cta-metric-card">
              <p>LINE Clicks</p>
              <strong>{metrics.line}</strong>
            </article>
          </div>

          <div className="cta-middle-grid">
            <section className="cta-section-card">
              <div className="card-title-row">
                <h3>Top Performing Listings</h3>
              </div>
              {topEntities.length ? (
                <div className="cta-listings-grid">
                  {topEntities.map((item) => (
                    <article key={`${item.entity_type}-${item.entity_id}`} className="cta-listing-card">
                      <p className="cta-listing-title">{item.title || "Untitled listing"}</p>
                      <p className="muted cta-listing-meta">
                        {item.category || "-"} / {item.slug || "-"}
                      </p>
                      <div className="cta-listing-stats">
                        <span>Total {normalizeCount(item.total_clicks)}</span>
                        <span>Map {normalizeCount(item.map_clicks)}</span>
                        <span>Phone {normalizeCount(item.phone_clicks)}</span>
                        <span>LINE {normalizeCount(item.line_clicks)}</span>
                      </div>
                      <p className="muted cta-listing-latest">Latest: {formatDateTime(item.latest_click_at)}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="cta-empty-card">No listing click data in this range.</div>
              )}
            </section>

            <section className="cta-section-card">
              <div className="card-title-row">
                <h3>Missing CTA Block / Needs Fix</h3>
              </div>
              {missingCta.length ? (
                <div className="cta-missing-grid">
                  {missingCta.map((item) => (
                    <article key={item.id} className="cta-missing-card">
                      <p className="cta-listing-title">{item.title || "Untitled place"}</p>
                      <p className="muted cta-listing-meta">
                        {item.category || "-"} / {item.slug || "-"}
                      </p>
                      <p className="cta-missing-label">Missing: {buildMissingLabel(item.missing)}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="cta-empty-card">No missing CTA fields found for approved places.</div>
              )}
            </section>
          </div>

          <section className="cta-section-card">
            <div className="card-title-row">
              <h3>Recent CTA Events</h3>
            </div>
            {recentEvents.length ? (
              <div className="table-wrap cta-recent-table-wrap">
                <table className="cta-recent-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Event</th>
                      <th>Entity</th>
                      <th>Source Path</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentEvents.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.created_at)}</td>
                        <td>{item.event_type || "-"}</td>
                        <td>{item.entity_type || "-"} {item.entity_id || "-"}</td>
                        <td className="cta-path-cell">{item.source_path || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="cta-empty-card">No recent CTA events.</div>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
