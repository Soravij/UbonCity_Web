import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, authHeaders } from "../api/api";

const LANGUAGE_OPTIONS = [
  { value: "th", label: "ไทย" },
  { value: "en", label: "อังกฤษ" },
  { value: "zh", label: "จีน" },
  { value: "lo", label: "ลาว" },
];

const FIXED_BLOCK_ORDER = ["hero", "top_picks", "trending", "scenarios", "featured_events"];
const FIXED_BLOCK_TYPES = {
  hero: "hero",
  top_picks: "place-list",
  trending: "place-list",
  scenarios: "scenario-grid",
  featured_events: "event-list",
};
const HERO_BLOCK_KEY = "hero";
const EVENT_BLOCK_KEY = "featured_events";

const SOURCE_MODE_OPTIONS = [
  { value: "manual-first-hybrid", label: "เลือกเองก่อน แล้วระบบช่วยเติม" },
  { value: "manual-only", label: "ใช้เฉพาะรายการที่เลือกเอง" },
  { value: "rule-only", label: "ให้ระบบเลือกจากเงื่อนไข" },
];

const FALLBACK_MODE_OPTIONS = [
  { value: "latest-approved", label: "ล่าสุดที่อนุมัติแล้ว" },
  { value: "featured", label: "รายการเด่น" },
  { value: "none", label: "ไม่ใช้รายการสำรอง" },
];

const SORT_BY_OPTIONS = [
  { value: "featured_then_recent", label: "เด่นก่อน แล้วตามด้วยล่าสุด" },
  { value: "recent", label: "ล่าสุดก่อน" },
  { value: "scenario_match", label: "ตรงกับสถานการณ์ก่อน" },
];

const ENTITY_TYPE_OPTIONS = [
  { value: "place", label: "สถานที่" },
  { value: "event", label: "อีเวนต์" },
];

const ENTITY_TYPE_LABEL = {
  place: "สถานที่",
  event: "อีเวนต์",
};

const BLOCK_TYPE_LABEL = {
  hero: "ฮีโร่",
  "place-list": "รายการสถานที่",
  "scenario-grid": "กริดสถานการณ์",
  "event-list": "รายการอีเวนต์",
};

const SOURCE_MODE_LABEL = {
  "manual-first-hybrid": "เลือกเองก่อน แล้วระบบช่วยเติม",
  "manual-only": "ใช้เฉพาะรายการที่เลือกเอง",
  "rule-only": "ให้ระบบเลือกจากเงื่อนไข",
};

function getEntityTypeLabel(value) {
  return ENTITY_TYPE_LABEL[String(value || "").trim().toLowerCase()] || "รายการ";
}

function getBlockTypeLabel(value) {
  return BLOCK_TYPE_LABEL[String(value || "").trim().toLowerCase()] || "บล็อก";
}

function getSourceModeLabel(value) {
  return SOURCE_MODE_LABEL[String(value || "").trim().toLowerCase()] || "ไม่ระบุ";
}

function getFixedBlockIndex(key) {
  return FIXED_BLOCK_ORDER.indexOf(String(key || "").trim().toLowerCase());
}

function sortBlocksByFixedOrder(blocks) {
  return [...(Array.isArray(blocks) ? blocks : [])].sort(
    (a, b) => getFixedBlockIndex(a?.key) - getFixedBlockIndex(b?.key)
  );
}

function isHeroBlock(block) {
  return String(block?.key || "").trim().toLowerCase() === HERO_BLOCK_KEY;
}

function isEventBlock(block) {
  return String(block?.key || "").trim().toLowerCase() === EVENT_BLOCK_KEY;
}

function createManualItem(entityType = "place") {
  return {
    entity_type: entityType,
    entity_id: "",
    category: "",
    slug: "",
    label: "",
    note: "",
  };
}

function normalizeRuleConfig(ruleConfig = {}) {
  return {
    category_scope: Array.isArray(ruleConfig?.category_scope)
      ? ruleConfig.category_scope.join(", ")
      : String(ruleConfig?.category_scope || "").trim(),
    scenario_tags: Array.isArray(ruleConfig?.scenario_tags)
      ? ruleConfig.scenario_tags.join(", ")
      : String(ruleConfig?.scenario_tags || "").trim(),
    sort_by: String(ruleConfig?.sort_by || "featured_then_recent").trim(),
  };
}

function sanitizeBlocks(blocks) {
  return sortBlocksByFixedOrder(blocks).map((block, index) => {
    const key = String(block?.key || "").trim().toLowerCase();
    const type = FIXED_BLOCK_TYPES[key] || String(block?.type || "place-list").trim().toLowerCase();
    const hero = isHeroBlock(block);
    const eventBlock = isEventBlock(block);
    const manualItems = Array.isArray(block?.manual_items)
      ? block.manual_items.map((item) => ({
          entity_type: eventBlock ? "event" : String(item?.entity_type || "place").trim().toLowerCase() || "place",
          entity_id: item?.entity_id ? String(item.entity_id) : "",
          category: String(item?.category || "").trim(),
          slug: String(item?.slug || "").trim(),
          label: String(item?.label || "").trim(),
          note: String(item?.note || "").trim(),
        }))
      : [];

    return {
      ...block,
      key,
      type,
      position: Number(block?.position || index + 1) || index + 1,
      enabled: Boolean(block?.enabled),
      source_mode: hero ? "manual-first-hybrid" : String(block?.source_mode || "manual-first-hybrid").trim().toLowerCase(),
      fallback_mode: hero ? "none" : String(block?.fallback_mode || "latest-approved").trim().toLowerCase(),
      min_items: hero ? 0 : Number(block?.min_items || 0) || 0,
      max_items: hero ? 0 : Number(block?.max_items || 0) || 0,
      manual_items: hero ? [] : manualItems,
      rule_config: normalizeRuleConfig(block?.rule_config),
    };
  });
}

function serializeBlocks(blocks) {
  return sortBlocksByFixedOrder(blocks).map((block, index) => {
    const key = String(block?.key || "").trim().toLowerCase();
    const hero = key === HERO_BLOCK_KEY;
    const eventBlock = key === EVENT_BLOCK_KEY;

    return {
      key,
      type: FIXED_BLOCK_TYPES[key] || String(block?.type || "place-list").trim().toLowerCase(),
      enabled: Boolean(block?.enabled),
      position: index + 1,
      title: String(block?.title || "").trim(),
      subtitle: String(block?.subtitle || "").trim(),
      source_mode: hero ? "manual-first-hybrid" : String(block?.source_mode || "manual-first-hybrid").trim().toLowerCase(),
      fallback_mode: hero ? "none" : String(block?.fallback_mode || "latest-approved").trim().toLowerCase(),
      min_items: hero ? 0 : Math.max(0, Number(block?.min_items || 0) || 0),
      max_items: hero ? 0 : Math.max(0, Number(block?.max_items || 0) || 0),
      manual_items: hero
        ? []
        : (Array.isArray(block?.manual_items) ? block.manual_items : [])
            .map((item) => ({
              entity_type: eventBlock ? "event" : String(item?.entity_type || "place").trim().toLowerCase() || "place",
              entity_id: Number(item?.entity_id || 0) || null,
              category: String(item?.category || "").trim().toLowerCase(),
              slug: String(item?.slug || "").trim(),
              label: String(item?.label || "").trim(),
              note: String(item?.note || "").trim(),
            }))
            .filter((item) => item.entity_id),
      rule_config: {
        category_scope: String(block?.rule_config?.category_scope || "")
          .split(/[,\n]/g)
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
        scenario_tags: String(block?.rule_config?.scenario_tags || "")
          .split(/[,\n]/g)
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
        sort_by: String(block?.rule_config?.sort_by || "featured_then_recent").trim(),
      },
    };
  });
}

function createCandidateState(entityType = "place") {
  return {
    q: "",
    entity_type: entityType,
    loading: false,
    error: "",
    items: [],
  };
}

function getDefaultCandidateEntityType(block) {
  return isEventBlock(block) ? "event" : "place";
}

export default function HomepageCuration({ token }) {
  const [lang, setLang] = useState("th");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [message, setMessage] = useState("");
  const [layoutMeta, setLayoutMeta] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [candidateByBlock, setCandidateByBlock] = useState({});
  const [previewBlocks, setPreviewBlocks] = useState([]);
  const previewRequestSeq = useRef(0);

  const serializedDraft = useMemo(() => serializeBlocks(blocks), [blocks]);

  const publishedBlockCount = useMemo(
    () => (Array.isArray(layoutMeta?.published_blocks) ? layoutMeta.published_blocks.length : 0),
    [layoutMeta]
  );

  const resetCandidateState = useCallback((nextBlocks) => {
    const nextState = {};
    for (const block of Array.isArray(nextBlocks) ? nextBlocks : []) {
      nextState[block.key] = createCandidateState(getDefaultCandidateEntityType(block));
    }
    setCandidateByBlock(nextState);
  }, []);

  const loadLayout = useCallback(async (nextLang = lang) => {
    setLoading(true);
    setMessage("");
    try {
      const res = await api.get("/homepage-curation/layout", {
        params: { layout_key: "home", lang: nextLang },
        headers: authHeaders(token),
      });
      const item = res.data?.item || null;
      const nextBlocks = sanitizeBlocks(item?.draft_blocks);
      setLayoutMeta(item);
      setBlocks(nextBlocks);
      resetCandidateState(nextBlocks);
      setPreviewBlocks([]);
      setPreviewError("");
    } catch (error) {
      setMessage(error.response?.data?.error || "โหลดข้อมูลหน้าแรกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [lang, resetCandidateState, token]);

  useEffect(() => {
    loadLayout(lang);
  }, [lang, loadLayout]);

  const loadPreview = useCallback(async (draftBlocks = serializedDraft, nextLang = lang) => {
    const requestId = previewRequestSeq.current + 1;
    previewRequestSeq.current = requestId;
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const res = await api.post(
        "/homepage-curation/preview",
        {
          layout_key: "home",
          lang: nextLang,
          draft_blocks: draftBlocks,
        },
        { headers: authHeaders(token) }
      );
      if (previewRequestSeq.current !== requestId) return;
      setPreviewBlocks(Array.isArray(res.data?.item?.resolved_blocks) ? res.data.item.resolved_blocks : []);
    } catch (error) {
      if (previewRequestSeq.current !== requestId) return;
      setPreviewBlocks([]);
      setPreviewError(error.response?.data?.error || "Failed to preview homepage curation layout");
    } finally {
      if (previewRequestSeq.current !== requestId) return;
      setPreviewLoading(false);
    }
  }, [lang, serializedDraft, token]);

  useEffect(() => {
    if (loading) return undefined;
    const timer = window.setTimeout(() => {
      loadPreview(serializedDraft, lang);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [lang, loadPreview, loading, serializedDraft]);

  function updateBlock(index, patch) {
    setBlocks((current) =>
      current.map((block, blockIndex) => (blockIndex === index ? { ...block, ...patch } : block))
    );
  }

  function updateRuleConfig(index, patch) {
    setBlocks((current) =>
      current.map((block, blockIndex) =>
        blockIndex === index
          ? {
              ...block,
              rule_config: {
                ...block.rule_config,
                ...patch,
              },
            }
          : block
      )
    );
  }

  function moveBlock(index, direction) {
    setBlocks((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      return next.map((block, blockIndex) => ({ ...block, position: blockIndex + 1 }));
    });
  }

  function addManualItem(blockIndex) {
    setBlocks((current) =>
      current.map((block, index) =>
        index === blockIndex
          ? {
              ...block,
              manual_items: [...block.manual_items, createManualItem(getDefaultCandidateEntityType(block))],
            }
          : block
      )
    );
  }

  function addManualCandidate(blockIndex, candidate) {
    const candidateId = Number(candidate?.id || 0) || null;
    if (!candidateId) return;

    setBlocks((current) =>
      current.map((block, index) => {
        if (index !== blockIndex) return block;
        const candidateType = getDefaultCandidateEntityType(block);
        const dup = block.manual_items.some(
          (item) => Number(item?.entity_id || 0) === candidateId && String(item?.entity_type || "") === candidateType
        );
        if (dup) return block;

        const nextItem = {
          entity_type: candidateType,
          entity_id: String(candidateId),
          category: String(candidate?.category || "").trim(),
          slug: String(candidate?.slug || "").trim(),
          label: String(candidate?.title || "").trim(),
          note: "",
        };
        return {
          ...block,
          manual_items: [...block.manual_items, nextItem],
        };
      })
    );
  }

  function updateManualItem(blockIndex, itemIndex, patch) {
    setBlocks((current) =>
      current.map((block, index) =>
        index === blockIndex
          ? {
              ...block,
              manual_items: block.manual_items.map((item, currentItemIndex) =>
                currentItemIndex === itemIndex ? { ...item, ...patch } : item
              ),
            }
          : block
      )
    );
  }

  function removeManualItem(blockIndex, itemIndex) {
    setBlocks((current) =>
      current.map((block, index) =>
        index === blockIndex
          ? {
              ...block,
              manual_items: block.manual_items.filter((_, currentItemIndex) => currentItemIndex !== itemIndex),
            }
          : block
      )
    );
  }

  function updateCandidateState(blockKey, patch) {
    setCandidateByBlock((current) => ({
      ...current,
      [blockKey]: {
        ...(current[blockKey] || createCandidateState()),
        ...patch,
      },
    }));
  }

  async function searchCandidates(block) {
    const key = String(block?.key || "");
    const state = candidateByBlock[key] || createCandidateState(getDefaultCandidateEntityType(block));
    updateCandidateState(key, { loading: true, error: "", items: [], entity_type: getDefaultCandidateEntityType(block) });
    try {
      const res = await api.get("/homepage-curation/candidates", {
        params: {
          entity_type: getDefaultCandidateEntityType(block),
          lang,
          q: state.q,
          limit: 20,
        },
        headers: authHeaders(token),
      });
      const items = Array.isArray(res.data?.items) ? res.data.items : [];
      updateCandidateState(key, { loading: false, items, entity_type: getDefaultCandidateEntityType(block) });
    } catch (error) {
      updateCandidateState(key, {
        loading: false,
        entity_type: getDefaultCandidateEntityType(block),
        error: error.response?.data?.error || "ค้นหารายการไม่สำเร็จ",
        items: [],
      });
    }
  }

  async function onSaveDraft() {
    setSaving(true);
    setMessage("");
    try {
      const res = await api.put(
        "/homepage-curation/layout",
        {
          layout_key: "home",
          lang,
          draft_blocks: serializeBlocks(blocks),
        },
        { headers: authHeaders(token) }
      );
      const item = res.data?.item || null;
      const nextBlocks = sanitizeBlocks(item?.draft_blocks);
      setLayoutMeta(item);
      setBlocks(nextBlocks);
      resetCandidateState(nextBlocks);
      setMessage("บันทึกฉบับร่างแล้ว");
      loadPreview(item?.draft_blocks || serializeBlocks(nextBlocks), lang);
    } catch (error) {
      setMessage(error.response?.data?.error || "บันทึกหน้าแรกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function onPublish() {
    setPublishing(true);
    setMessage("");
    try {
      const res = await api.post(
        "/homepage-curation/layout/publish",
        {
          layout_key: "home",
          lang,
        },
        { headers: authHeaders(token) }
      );
      const item = res.data?.item || null;
      const nextBlocks = sanitizeBlocks(item?.draft_blocks);
      setLayoutMeta(item);
      setBlocks(nextBlocks);
      resetCandidateState(nextBlocks);
      setMessage("เผยแพร่เลย์เอาต์แล้ว");
      loadPreview(item?.draft_blocks || serializeBlocks(nextBlocks), lang);
    } catch (error) {
      setMessage(error.response?.data?.error || "เผยแพร่หน้าแรกไม่สำเร็จ");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section className="admin-card homepage-curation-surface">
      <div className="card-title-row homepage-curation-head">
        <div>
          <h2>จัดหน้าแรก</h2>
          <p className="muted">จัดลำดับและเลือกวิธีแสดงผลของช่องคงที่บนหน้าแรก โดยไม่แก้ข้อมูลคอนเทนต์จริง</p>
        </div>
        <div className="homepage-curation-head-actions">
          <button type="button" className="ghost" onClick={() => loadLayout(lang)} disabled={loading}>
            รีเฟรช
          </button>
          <button type="button" className="ghost" onClick={() => loadPreview(serializedDraft, lang)} disabled={loading || previewLoading}>
            {previewLoading ? "กำลังประมวลผล..." : "รีเฟรชตัวอย่าง"}
          </button>
          <button type="button" className="primary" onClick={onSaveDraft} disabled={loading || saving}>
            {saving ? "กำลังบันทึก..." : "บันทึกฉบับร่าง"}
          </button>
          <button type="button" className="primary" onClick={onPublish} disabled={loading || publishing || saving}>
            {publishing ? "กำลังเผยแพร่..." : "เผยแพร่เลย์เอาต์"}
          </button>
        </div>
      </div>

      <div className="homepage-curation-toolbar">
        <label>
          ภาษา
          <select value={lang} onChange={(event) => setLang(event.target.value)} disabled={loading}>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="homepage-curation-summary-grid">
          <div className="homepage-curation-summary-card">
            <span>บล็อกฉบับร่าง</span>
            <strong>{blocks.length}</strong>
          </div>
          <div className="homepage-curation-summary-card">
            <span>บล็อกที่เผยแพร่แล้ว</span>
            <strong>{publishedBlockCount}</strong>
          </div>
          <div className="homepage-curation-summary-card">
            <span>เผยแพร่ล่าสุด</span>
            <strong>{layoutMeta?.published_at ? new Date(layoutMeta.published_at).toLocaleString() : "-"}</strong>
          </div>
        </div>
      </div>

      {message ? <p className="status">{message}</p> : null}

      {loading ? (
        <p className="muted">กำลังโหลดข้อมูลหน้าแรก...</p>
      ) : (
        <div className="homepage-curation-block-list">
          <article className="homepage-curation-block-card">
            <div className="homepage-curation-block-head">
              <div>
                <p className="homepage-curation-block-kicker">ตัวอย่างผลลัพธ์</p>
                <h3>ตัวอย่างหน้าแรก</h3>
                <p className="muted">ผลลัพธ์จากการจัดวางช่องคงที่หลังรวมรายการเลือกเอง กฎ และรายการสำรอง</p>
              </div>
            </div>

            {previewError ? <p className="status">{previewError}</p> : null}
            {previewLoading ? <p className="muted">กำลังประมวลผลตัวอย่าง...</p> : null}
            {!previewLoading && !previewBlocks.length && !previewError ? (
              <p className="muted">ยังไม่พบบล็อกที่แสดงผลได้ในฉบับร่างปัจจุบัน</p>
            ) : null}

            {previewBlocks.length ? (
              <div className="homepage-curation-preview-list">
                {previewBlocks.map((block) => (
                  <div key={`preview-${block.key}`} className="homepage-curation-preview-card">
                    <div className="homepage-curation-preview-head">
                      <div>
                        <strong>{block.title || block.key}</strong>
                        <p className="muted">
                          {getBlockTypeLabel(block.type)} | {getSourceModeLabel(block.source_mode)} | {Array.isArray(block.resolved_items) ? block.resolved_items.length : 0} รายการ
                        </p>
                      </div>
                      {Array.isArray(block.manual_misses) && block.manual_misses.length ? (
                        <span className="homepage-curation-preview-warning">รายการเลือกเองที่ไม่พบ {block.manual_misses.length}</span>
                      ) : null}
                    </div>

                    {Array.isArray(block.manual_misses) && block.manual_misses.length ? (
                      <div className="homepage-curation-preview-misses">
                        {block.manual_misses.map((item) => (
                          <span key={`${block.key}-miss-${item.entity_type}-${item.entity_id}`}>
                            {getEntityTypeLabel(item.entity_type)} #{item.entity_id}{item.slug ? ` | รหัส: ${item.slug}` : ""}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {Array.isArray(block.resolved_items) && block.resolved_items.length ? (
                      <div className="homepage-curation-preview-items">
                        {block.resolved_items.slice(0, 8).map((item, itemIndex) => (
                          <div key={`${block.key}-resolved-${item.entity_type}-${item.id}`} className="homepage-curation-preview-item">
                            <span>{itemIndex + 1}</span>
                            <div>
                              <strong>{item.title || "-"}</strong>
                              <p className="muted">
                                {getEntityTypeLabel(item.entity_type)} #{item.id}
                                {item.category ? ` | ${item.category}` : ""}
                                {item.slug ? ` | รหัส: ${item.slug}` : ""}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">บล็อกนี้จะไม่แสดงผลในฉบับร่างปัจจุบัน</p>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </article>

          {blocks.map((block, index) => {
            const candidateState = candidateByBlock[block.key] || createCandidateState(getDefaultCandidateEntityType(block));
            const hero = isHeroBlock(block);
            const eventBlock = isEventBlock(block);

            return (
              <article key={block.key || index} className="homepage-curation-block-card">
                <div className="homepage-curation-block-head">
                  <div>
                    <p className="homepage-curation-block-kicker">
                      {getBlockTypeLabel(block.type)} | ลำดับ #{index + 1}
                    </p>
                    <h3>{block.title || block.key}</h3>
                    <p className="muted">{block.key}</p>
                  </div>
                  <div className="actions">
                    <button type="button" className="ghost tiny-btn" onClick={() => moveBlock(index, -1)} disabled={index === 0}>
                      ขึ้น
                    </button>
                    <button type="button" className="ghost tiny-btn" onClick={() => moveBlock(index, 1)} disabled={index === blocks.length - 1}>
                      ลง
                    </button>
                  </div>
                </div>

                <div className="grid two homepage-curation-grid">
                  <label>
                    ชื่อบล็อก
                    <input value={block.title} onChange={(event) => updateBlock(index, { title: event.target.value })} />
                  </label>
                  <label>
                    คำอธิบายย่อย
                    <input value={block.subtitle} onChange={(event) => updateBlock(index, { subtitle: event.target.value })} />
                  </label>
                  <label className="homepage-curation-checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(block.enabled)}
                      onChange={(event) => updateBlock(index, { enabled: event.target.checked })}
                    />
                    <span>เปิดใช้งานบล็อกนี้</span>
                  </label>

                  {!hero ? (
                    <>
                      <label>
                        วิธีเลือกเนื้อหา
                        <select value={block.source_mode} onChange={(event) => updateBlock(index, { source_mode: event.target.value })}>
                          {SOURCE_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        รายการสำรอง
                        <select value={block.fallback_mode} onChange={(event) => updateBlock(index, { fallback_mode: event.target.value })}>
                          {FALLBACK_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        จำนวนขั้นต่ำ
                        <input type="number" min="0" value={block.min_items} onChange={(event) => updateBlock(index, { min_items: event.target.value })} />
                      </label>
                      <label>
                        จำนวนสูงสุด
                        <input type="number" min="0" value={block.max_items} onChange={(event) => updateBlock(index, { max_items: event.target.value })} />
                      </label>
                    </>
                  ) : null}
                </div>

                {!hero ? (
                  <div className="homepage-curation-rule-panel">
                    <h4>ตั้งค่ากฎ</h4>
                    <div className="grid two">
                      <label>
                        ขอบเขตหมวดหมู่
                        <input
                          value={block.rule_config?.category_scope || ""}
                          onChange={(event) => updateRuleConfig(index, { category_scope: event.target.value })}
                          placeholder="เช่น attractions, cafes, restaurants"
                        />
                      </label>
                      <label>
                        แท็กสถานการณ์
                        <input
                          value={block.rule_config?.scenario_tags || ""}
                          onChange={(event) => updateRuleConfig(index, { scenario_tags: event.target.value })}
                          placeholder="เช่น day-trip, budget-500, family"
                        />
                      </label>
                      <label className="full">
                        วิธีเรียงลำดับ
                        <select value={block.rule_config?.sort_by || "featured_then_recent"} onChange={(event) => updateRuleConfig(index, { sort_by: event.target.value })}>
                          {SORT_BY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                ) : null}

                {!hero ? (
                  <div className="homepage-curation-rule-panel">
                    <div className="card-title-row">
                      <h4>รายการเลือกเอง</h4>
                      <button type="button" className="ghost tiny-btn" onClick={() => addManualItem(index)}>
                        เพิ่มแถวว่าง
                      </button>
                    </div>

                    <div className="grid two">
                      <label>
                        ประเภทรายการ
                        <select value={getDefaultCandidateEntityType(block)} disabled>
                          {ENTITY_TYPE_OPTIONS.filter((option) => option.value === getDefaultCandidateEntityType(block)).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        ค้นหารายการ
                        <input
                          value={candidateState.q}
                          onChange={(event) => updateCandidateState(block.key, { q: event.target.value, entity_type: getDefaultCandidateEntityType(block) })}
                          placeholder={eventBlock ? "ค้นหาชื่ออีเวนต์" : "ค้นหาด้วยชื่อหรือรหัสรายการ"}
                        />
                      </label>
                    </div>

                    <div className="actions">
                      <button type="button" className="ghost" onClick={() => searchCandidates(block)} disabled={candidateState.loading}>
                        {candidateState.loading ? "กำลังค้นหา..." : "ค้นหารายการ"}
                      </button>
                    </div>

                    {candidateState.error ? <p className="muted">{candidateState.error}</p> : null}
                    {candidateState.items.length ? (
                      <div className="homepage-curation-manual-list">
                        {candidateState.items.map((candidate) => (
                          <div key={`${block.key}-cand-${candidate.entity_type}-${candidate.id}`} className="homepage-curation-manual-row">
                            <div>
                              <strong>{candidate.title || "-"}</strong>
                              <p className="muted">
                                {getEntityTypeLabel(candidate.entity_type)} #{candidate.id}
                                {candidate.category ? ` | ${candidate.category}` : ""}
                                {candidate.slug ? ` | รหัส: ${candidate.slug}` : ""}
                              </p>
                            </div>
                            <div className="actions">
                              <button type="button" className="ghost tiny-btn" onClick={() => addManualCandidate(index, candidate)}>
                                เพิ่มเข้ารายการเลือกเอง
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {block.manual_items.length === 0 ? (
                      <p className="muted">ยังไม่มีรายการเลือกเอง ระบบจะใช้วิธีเลือกเนื้อหาตามที่ตั้งไว้</p>
                    ) : (
                      <div className="homepage-curation-manual-list">
                        {block.manual_items.map((item, itemIndex) => (
                          <div key={`${block.key}-manual-${itemIndex}`} className="homepage-curation-manual-row">
                            <label>
                              ประเภท
                              <select
                                value={eventBlock ? "event" : item.entity_type}
                                disabled={eventBlock}
                                onChange={(event) => updateManualItem(index, itemIndex, { entity_type: event.target.value })}
                              >
                                {(eventBlock ? ENTITY_TYPE_OPTIONS.filter((option) => option.value === "event") : ENTITY_TYPE_OPTIONS).map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              รหัสรายการ
                              <input value={item.entity_id} onChange={(event) => updateManualItem(index, itemIndex, { entity_id: event.target.value })} placeholder="123" />
                            </label>
                            <label>
                              หมวดหมู่
                              <input value={item.category} onChange={(event) => updateManualItem(index, itemIndex, { category: event.target.value })} placeholder="เช่น attractions" />
                            </label>
                            <label>
                              รหัส slug
                              <input value={item.slug} onChange={(event) => updateManualItem(index, itemIndex, { slug: event.target.value })} placeholder="เช่น wat-phra-that" />
                            </label>
                            <label>
                              ป้ายชื่อ
                              <input value={item.label} onChange={(event) => updateManualItem(index, itemIndex, { label: event.target.value })} placeholder="ชื่อภายในทีม" />
                            </label>
                            <label>
                              หมายเหตุ
                              <input value={item.note} onChange={(event) => updateManualItem(index, itemIndex, { note: event.target.value })} placeholder="เหตุผลที่ต้องอยู่ในบล็อกนี้" />
                            </label>
                            <div className="actions">
                              <button type="button" className="danger tiny-btn" onClick={() => removeManualItem(index, itemIndex)}>
                                ลบ
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
