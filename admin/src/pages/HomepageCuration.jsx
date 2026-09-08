import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, authHeaders } from "../api/api";
import Situations from "./Situations";
import Shortcuts from "./Shortcuts";
import {
  EVENT_BLOCK_KEY,
  HERO_BLOCK_KEY,
  applyPoolEntityTypeChange,
  buildPoolCandidateParams,
  candidateSelectionKey,
  clearPoolTaxonomySelection,
  isEventBlock,
  isHeroBlock,
  selectCurrentCandidateRows,
  selectedTaxonomyLookupKeys,
  toggleCandidateSelection,
  updateTaxonomyLookupSlot,
} from "../lib/homepageCurationPool";

const LANGUAGE_OPTIONS = [
  { value: "th", label: "ไทย" },
  { value: "en", label: "อังกฤษ" },
  { value: "zh", label: "จีน" },
  { value: "lo", label: "ลาว" },
];

const FIXED_BLOCK_ORDER = ["hero", "highlight", "scenarios", "featured_events"];
const EDIT_LANG = "th";
const FIXED_BLOCK_TYPES = {
  hero: "hero",
  highlight: "place-list",
  scenarios: "scenario-grid",
  featured_events: "event-list",
};
const TAB_LAYOUT = "layout";
const TAB_HIGHLIGHT = "highlight";
const TAB_SITUATIONS = "situations";
const TAB_HERO = "hero";
const TAB_EVENTS = "events";
const TAB_SIGNALS = "signals";

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

function getEntityTypeLabel(value) {
  return ENTITY_TYPE_LABEL[String(value || "").trim().toLowerCase()] || "รายการ";
}

function getBlockTypeLabel(value) {
  return BLOCK_TYPE_LABEL[String(value || "").trim().toLowerCase()] || "บล็อก";
}

function normalizeFixedBlocksInCurrentOrder(blocks) {
  const seenKeys = new Set();
  const normalized = [];

  for (const block of Array.isArray(blocks) ? blocks : []) {
    const key = String(block?.key || "").trim().toLowerCase();
    if (!FIXED_BLOCK_ORDER.includes(key) || seenKeys.has(key)) continue;
    seenKeys.add(key);
    normalized.push(block);
  }

  for (const key of FIXED_BLOCK_ORDER) {
    if (seenKeys.has(key)) continue;
    normalized.push({
      key,
      type: FIXED_BLOCK_TYPES[key],
      enabled: true,
      title: "",
      subtitle: "",
      source_mode: "manual-first-hybrid",
      fallback_mode: key === HERO_BLOCK_KEY ? "none" : "latest-approved",
      min_items: key === HERO_BLOCK_KEY ? 0 : 0,
      max_items: key === HERO_BLOCK_KEY ? 0 : 0,
      manual_items: [],
      rule_config: {
        category_scope: "",
        scenario_tags: "",
        sort_by: "featured_then_recent",
      },
    });
  }

  return normalized;
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
  return normalizeFixedBlocksInCurrentOrder(blocks).map((block, index) => {
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
  return normalizeFixedBlocksInCurrentOrder(blocks).map((block, index) => {
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
    taxonomy_true: ["", "", ""],
    loading: false,
    error: "",
    items: [],
  };
}

function getDefaultCandidateEntityType(block) {
  return isEventBlock(block) ? "event" : "place";
}

export default function HomepageCuration({ token }) {
  const [activeTab, setActiveTab] = useState(TAB_LAYOUT);
  const [previewLang, setPreviewLang] = useState("th");
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
  const [previewSituations, setPreviewSituations] = useState([]);
  const [poolState, setPoolState] = useState(createCandidateState("place"));
  const [taxonomyCatalog, setTaxonomyCatalog] = useState([]);
  const [taxonomyCatalogError, setTaxonomyCatalogError] = useState("");
  const [poolSelectedCandidateKeys, setPoolSelectedCandidateKeys] = useState([]);
  const [situationsList, setSituationsList] = useState([]);
  const [selectedSituationSlugs, setSelectedSituationSlugs] = useState([]);
  const [poolSituationStatus, setPoolSituationStatus] = useState("");
  const [shortcutsList, setShortcutsList] = useState([]);
  const [selectedShortcutSlugs, setSelectedShortcutSlugs] = useState([]);
  const [poolShortcutStatus, setPoolShortcutStatus] = useState("");
  const previewRequestSeq = useRef(0);

  const serializedDraft = useMemo(() => serializeBlocks(blocks), [blocks]);

  const publishedBlockCount = useMemo(
    () => (Array.isArray(layoutMeta?.published_blocks) ? layoutMeta.published_blocks.length : 0),
    [layoutMeta]
  );

  const selectedPoolCandidates = useMemo(() => {
    const selected = new Set(poolSelectedCandidateKeys);
    return poolState.items.filter((candidate) => selected.has(candidateSelectionKey(candidate)));
  }, [poolSelectedCandidateKeys, poolState.items]);

  useEffect(() => {
    if (poolState.entity_type !== "place") return;
    let active = true;
    async function loadTaxonomyCatalog() {
      setTaxonomyCatalogError("");
      try {
        const res = await api.get("/homepage-curation/taxonomy-catalog", {
          params: { entity_type: "place" },
          headers: authHeaders(token),
        });
        if (active) setTaxonomyCatalog(Array.isArray(res.data?.items) ? res.data.items : []);
      } catch (error) {
        if (active) {
          setTaxonomyCatalog([]);
          setPoolState(clearPoolTaxonomySelection);
          setPoolSelectedCandidateKeys([]);
          setTaxonomyCatalogError(error.response?.data?.error || "โหลดคุณสมบัติสำหรับกรองไม่สำเร็จ ตัวกรองคุณสมบัติถูกล้างแล้ว");
        }
      }
    }
    loadTaxonomyCatalog();
    return () => { active = false; };
  }, [poolState.entity_type, token]);

  useEffect(() => {
    let active = true;
    async function loadSituations() {
      try {
        const res = await api.get("/situations");
        if (active) setSituationsList(Array.isArray(res.data?.items) ? res.data.items : []);
      } catch {
        if (active) setSituationsList([]);
      }
    }
    loadSituations();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadShortcuts() {
      try {
        const res = await api.get("/shortcuts");
        if (active) setShortcutsList(Array.isArray(res.data?.items) ? res.data.items : []);
      } catch {
        if (active) setShortcutsList([]);
      }
    }
    loadShortcuts();
    return () => { active = false; };
  }, []);

  const resetCandidateState = useCallback((nextBlocks) => {
    const nextState = {};
    for (const block of Array.isArray(nextBlocks) ? nextBlocks : []) {
      nextState[block.key] = createCandidateState(getDefaultCandidateEntityType(block));
    }
    setCandidateByBlock(nextState);
  }, []);

  const loadLayout = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await api.get("/homepage-curation/layout", {
        params: { layout_key: "home", lang: EDIT_LANG },
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
  }, [resetCandidateState, token]);

  useEffect(() => {
    loadLayout();
  }, [loadLayout]);

  const loadPreview = useCallback(async (draftBlocks = serializedDraft, nextLang = previewLang) => {
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
      setPreviewSituations(Array.isArray(res.data?.item?.situations) ? res.data.item.situations : []);
    } catch (error) {
      if (previewRequestSeq.current !== requestId) return;
      setPreviewBlocks([]);
      setPreviewSituations([]);
      setPreviewError(error.response?.data?.error || "Failed to preview homepage curation layout");
    } finally {
      if (previewRequestSeq.current === requestId) setPreviewLoading(false);
    }
  }, [previewLang, serializedDraft, token]);

  useEffect(() => {
    if (loading) return undefined;
    const timer = window.setTimeout(() => {
      loadPreview(serializedDraft, previewLang);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [previewLang, loadPreview, loading, serializedDraft]);

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

  function moveManualItem(blockIndex, itemIndex, direction) {
    setBlocks((current) =>
      current.map((block, bIdx) => {
        if (bIdx !== blockIndex) return block;
        const target = itemIndex + direction;
        if (target < 0 || target >= block.manual_items.length) return block;
        const next = [...block.manual_items];
        const temp = next[itemIndex];
        next[itemIndex] = next[target];
        next[target] = temp;
        return { ...block, manual_items: next };
      })
    );
  }

  function addManualCandidate(blockIndex, candidate) {
    const candidateId = Number(candidate?.id || 0) || null;
    if (!candidateId) return;

    setBlocks((current) =>
      current.map((block, index) => {
        if (index !== blockIndex) return block;
        const candidateType = getDefaultCandidateEntityType(block);
        const eventBlock = isEventBlock(block);
        if (!eventBlock) {
          const dup = block.manual_items.some(
            (item) => Number(item?.entity_id || 0) === candidateId && String(item?.entity_type || "") === candidateType
          );
          if (dup) return block;
        }

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
          manual_items: eventBlock ? [nextItem] : [...block.manual_items, nextItem],
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

  function updatePoolState(patch) {
    setPoolState((current) => ({
      ...current,
      ...patch,
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
          lang: EDIT_LANG,
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

  async function searchPoolCandidates() {
    setPoolSelectedCandidateKeys([]);
    setPoolState((current) => ({
      ...current,
      loading: true,
      error: "",
      items: [],
    }));
    try {
      const res = await api.get("/homepage-curation/candidates", {
        params: buildPoolCandidateParams({
          entityType: poolState.entity_type,
          lang: EDIT_LANG,
          q: poolState.q,
          limit: 20,
          taxonomyTrue: selectedTaxonomyLookupKeys(poolState.taxonomy_true),
        }),
        headers: authHeaders(token),
      });
      setPoolState((current) => ({
        ...current,
        loading: false,
        items: Array.isArray(res.data?.items) ? res.data.items : [],
      }));
    } catch (error) {
      setPoolState((current) => ({
        ...current,
        loading: false,
        error: error.response?.data?.error || "ค้นหารายการไม่สำเร็จ",
        items: [],
      }));
    }
  }

  async function addSelectedPoolCandidatesToSituations() {
    if (!selectedSituationSlugs.length || !selectedPoolCandidates.length) return;
    const placeIds = selectedPoolCandidates
      .filter((c) => String(c.entity_type || "").toLowerCase() === "place")
      .map((c) => Number(c.id))
      .filter(Boolean);
    if (!placeIds.length) {
      setPoolSituationStatus("รายการที่เลือกไม่มีสถานที่");
      return;
    }
    setPoolSituationStatus("กำลังบันทึก...");
    let ok = 0;
    let fail = 0;
    for (const slug of selectedSituationSlugs) {
      try {
        await api.post(`/situations/${slug}/places`, { place_ids: placeIds }, { headers: authHeaders(token) });
        ok++;
      } catch {
        fail++;
      }
    }
    setPoolSituationStatus(
      fail === 0
        ? `เพิ่ม ${placeIds.length} สถานที่เข้า ${ok} situation แล้ว`
        : `สำเร็จ ${ok} ล้มเหลว ${fail} — ตรวจสอบอีกครั้ง`
    );
    setPoolSelectedCandidateKeys([]);
  }

  async function addPoolCandidateToSituations(candidate) {
    if (!selectedSituationSlugs.length) return;
    const placeId = Number(candidate?.id);
    if (!placeId || String(candidate?.entity_type || "").toLowerCase() !== "place") return;
    setPoolSituationStatus("กำลังบันทึก...");
    let ok = 0;
    let fail = 0;
    for (const slug of selectedSituationSlugs) {
      try {
        await api.post(`/situations/${slug}/places`, { place_ids: [placeId] }, { headers: authHeaders(token) });
        ok++;
      } catch {
        fail++;
      }
    }
    setPoolSituationStatus(
      fail === 0
        ? `เพิ่มเข้า ${ok} situation แล้ว`
        : `สำเร็จ ${ok} ล้มเหลว ${fail}`
    );
  }

  async function addSelectedPoolCandidatesToShortcuts() {
    if (!selectedShortcutSlugs.length || !selectedPoolCandidates.length) return;
    const placeIds = selectedPoolCandidates
      .filter((c) => String(c.entity_type || "").toLowerCase() === "place")
      .map((c) => Number(c.id))
      .filter(Boolean);
    if (!placeIds.length) {
      setPoolShortcutStatus("รายการที่เลือกไม่มีสถานที่");
      return;
    }
    setPoolShortcutStatus("กำลังบันทึก...");
    let ok = 0;
    let fail = 0;
    for (const slug of selectedShortcutSlugs) {
      try {
        await api.post(`/shortcuts/${slug}/places`, { place_ids: placeIds }, { headers: authHeaders(token) });
        ok++;
      } catch {
        fail++;
      }
    }
    setPoolShortcutStatus(
      fail === 0
        ? `เพิ่ม ${placeIds.length} สถานที่เข้า ${ok} Shortcut แล้ว`
        : `สำเร็จ ${ok} ล้มเหลว ${fail} — ตรวจสอบอีกครั้ง`
    );
    setPoolSelectedCandidateKeys([]);
    setSelectedShortcutSlugs([]);
  }

  async function addPoolCandidateToShortcuts(candidate) {
    if (!selectedShortcutSlugs.length) return;
    const placeId = Number(candidate?.id);
    if (!placeId || String(candidate?.entity_type || "").toLowerCase() !== "place") return;
    setPoolShortcutStatus("กำลังบันทึก...");
    let ok = 0;
    let fail = 0;
    for (const slug of selectedShortcutSlugs) {
      try {
        await api.post(`/shortcuts/${slug}/places`, { place_ids: [placeId] }, { headers: authHeaders(token) });
        ok++;
      } catch {
        fail++;
      }
    }
    setPoolShortcutStatus(
      fail === 0
        ? `เพิ่มเข้า ${ok} Shortcut แล้ว`
        : `สำเร็จ ${ok} ล้มเหลว ${fail}`
    );
  }

  async function onSaveDraft() {
    setSaving(true);
    setMessage("");
    try {
      const res = await api.put(
        "/homepage-curation/layout",
        {
          layout_key: "home",
          lang: EDIT_LANG,
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
      loadPreview(item?.draft_blocks || serializeBlocks(nextBlocks), previewLang);
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
          lang: EDIT_LANG,
        },
        { headers: authHeaders(token) }
      );
      const item = res.data?.item || null;
      const nextBlocks = sanitizeBlocks(item?.draft_blocks);
      setLayoutMeta(item);
      setBlocks(nextBlocks);
      resetCandidateState(nextBlocks);
      setMessage("เผยแพร่เลย์เอาต์แล้ว");
      loadPreview(item?.draft_blocks || serializeBlocks(nextBlocks), previewLang);
    } catch (error) {
      setMessage(error.response?.data?.error || "เผยแพร่หน้าแรกไม่สำเร็จ");
    } finally {
      setPublishing(false);
    }
  }

  function renderBlockEditor(block, index) {
    const candidateState = candidateByBlock[block.key] || createCandidateState(getDefaultCandidateEntityType(block));
    const eventBlock = isEventBlock(block);

    return (
      <div className="homepage-curation-rule-panel">
        <div className="card-title-row">
          <h4>{eventBlock ? "อีเวนต์ปักหมุด" : "รายการเลือกเอง"}</h4>
        </div>

        <div className="grid two">
          {!eventBlock ? (
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
          ) : null}
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
        {!candidateState.q.trim() ? (
          <p className="muted">พิมพ์คำค้นแล้วกดค้นหา</p>
        ) : candidateState.items.length ? (() => {
          const maxReached = block.max_items > 0 && block.manual_items.length >= block.max_items;
          const filtered = candidateState.items.filter(
            (c) => !block.manual_items.some((m) => Number(m.entity_id) === Number(c.id) && m.entity_type === c.entity_type)
          );
          const shown = filtered.slice(0, 8);
          const remaining = filtered.length - shown.length;
          return (
            <div className="homepage-curation-manual-list">
              {maxReached ? <p className="muted">ครบตามจำนวนที่ตั้งไว้แล้ว</p> : null}
              {shown.map((candidate) => (
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
                    <button type="button" className="ghost tiny-btn" onClick={() => addManualCandidate(index, candidate)} disabled={maxReached}>
                      {eventBlock ? "เพิ่มเข้ารายการปักหมุด" : "เพิ่มเข้ารายการเลือกเอง"}
                    </button>
                  </div>
                </div>
              ))}
              {remaining > 0 ? <p className="muted">มีอีก {remaining} รายการ — พิมพ์คำค้นให้แคบลง</p> : null}
            </div>
          );
        })() : null}

        {block.manual_items.length === 0 ? (
          <p className="muted">{eventBlock ? "ยังไม่ได้ปักหมุด ระบบจะเรียงอัตโนมัติทั้ง 5 การ์ด" : "ยังไม่มีรายการเลือกเอง ระบบจะใช้วิธีเลือกเนื้อหาตามที่ตั้งไว้"}</p>
        ) : (
          <div className="homepage-curation-manual-list">
            {block.manual_items.map((item, itemIndex) => (
              <div key={`${block.key}-manual-${itemIndex}`} className="homepage-curation-manual-row">
                {!eventBlock ? (
                <label>
                  ประเภท
                  <select
                    value={item.entity_type}
                    onChange={(event) => updateManualItem(index, itemIndex, { entity_type: event.target.value })}
                  >
                    {ENTITY_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                ) : null}
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
                  {!eventBlock ? (
                    <>
                      <button type="button" className="ghost tiny-btn" onClick={() => moveManualItem(index, itemIndex, -1)} disabled={itemIndex === 0}>
                        ขึ้น
                      </button>
                      <button type="button" className="ghost tiny-btn" onClick={() => moveManualItem(index, itemIndex, 1)} disabled={itemIndex === block.manual_items.length - 1}>
                        ลง
                      </button>
                    </>
                  ) : null}
                  <button type="button" className="danger tiny-btn" onClick={() => removeManualItem(index, itemIndex)}>
                    ลบ
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="admin-card homepage-curation-surface">
      <div className="card-title-row homepage-curation-head">
        <div>
          <h2>จัดหน้าแรก</h2>
          <p className="muted">จัดลำดับและเลือกวิธีแสดงผลของช่องคงที่บนหน้าแรก โดยไม่แก้ข้อมูลคอนเทนต์จริง</p>
        </div>
        <div className="homepage-curation-head-actions">
          <button type="button" className="ghost" onClick={() => loadLayout()} disabled={loading}>
            รีเฟรช
          </button>
          {activeTab === TAB_LAYOUT || activeTab === TAB_HERO ? (
            <>
              <button type="button" className="ghost" onClick={() => loadPreview(serializedDraft, previewLang)} disabled={loading || previewLoading}>
                {previewLoading ? "กำลังประมวลผล..." : "รีเฟรชตัวอย่าง"}
              </button>
              <button type="button" className="primary" onClick={onSaveDraft} disabled={loading || saving}>
                {saving ? "กำลังบันทึก..." : "บันทึกฉบับร่าง"}
              </button>
              <button type="button" className="primary" onClick={onPublish} disabled={loading || publishing || saving}>
                {publishing ? "กำลังเผยแพร่..." : "เผยแพร่ทุกภาษา"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="homepage-curation-toolbar">
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

      <div className="actions" style={{ display: "flex", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" className={activeTab === TAB_LAYOUT ? "primary" : "ghost"} onClick={() => setActiveTab(TAB_LAYOUT)}>
            Layout
          </button>
          <button type="button" className={activeTab === TAB_HERO ? "primary" : "ghost"} onClick={() => setActiveTab(TAB_HERO)}>
            ฮีโร่
          </button>
          <button type="button" className={activeTab === TAB_HIGHLIGHT ? "primary" : "ghost"} onClick={() => setActiveTab(TAB_HIGHLIGHT)}>
            ไฮไลต์
          </button>
          <button type="button" className={activeTab === TAB_SITUATIONS ? "primary" : "ghost"} onClick={() => setActiveTab(TAB_SITUATIONS)}>
            สถานการณ์
          </button>
          <button type="button" className={activeTab === TAB_EVENTS ? "primary" : "ghost"} onClick={() => setActiveTab(TAB_EVENTS)}>
            อีเวนต์
          </button>
        </div>
        <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
          <button type="button" className={activeTab === TAB_SIGNALS ? "primary" : "ghost"} onClick={() => setActiveTab(TAB_SIGNALS)}>
            Signals / Content Pool
          </button>
        </div>
      </div>

      {loading ? (
        <p className="muted">กำลังโหลดข้อมูลหน้าแรก...</p>
      ) : activeTab === TAB_LAYOUT ? (
        <div className="homepage-curation-block-list">
          <div className="actions" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={previewLang === option.value ? "primary" : "ghost"}
                onClick={() => setPreviewLang(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {previewError ? <p className="status">{previewError}</p> : null}
          {previewLoading ? <p className="muted">กำลังประมวลผลตัวอย่าง...</p> : null}

          {(() => {
            const heroBlock = (previewBlocks || []).find((b) => b.key === "hero") || {};
            const highlightBlock = (previewBlocks || []).find((b) => b.key === "highlight") || {};
            const scenariosBlock = (previewBlocks || []).find((b) => b.key === "scenarios") || {};
            const eventsBlock = (previewBlocks || []).find((b) => b.key === "featured_events") || {};

            const hlItems = highlightBlock.resolved_items || [];
            const hlManualSet = new Set(
              (highlightBlock.hydrated_manual_items || []).map((m) => `${m.entity_type}:${Number(m.id)}`)
            );

            const evItems = eventsBlock.resolved_items || [];
            const evManualSet = new Set(
              (eventsBlock.hydrated_manual_items || []).map((m) => `${m.entity_type}:${Number(m.id)}`)
            );
            const evSlots = Array.from({ length: 5 }, (_, i) => evItems[i] || null);

            return (
              <div className="homepage-curation-mock">
                <div className="hcm-hero">
                  <div className="hcm-hero-left">
                    <h3 className="hcm-hero-title">{heroBlock.title || "hero"}</h3>
                    <p className="hcm-hero-sub">{heroBlock.subtitle || ""}</p>
                    <div className="hcm-searchbar" />
                  </div>
                  <div className="hcm-hero-right">
                    <div className="hcm-info-card" />
                    <div className="hcm-info-card" />
                    <div className="hcm-info-card" />
                  </div>
                </div>

                <section className="hcm-section">
                  <p className="hcm-eyebrow">Places</p>
                  <h4 className="hcm-heading">{highlightBlock.title || "highlight"}</h4>
                  <div className="hcm-strip">
                    {hlItems.map((item) => {
                      const cover = item.effective_thumbnail_image || item.effective_cover_image || item.image || "";
                        return (
                          <div key={`hl-${item.entity_type}-${item.id}`} className={`hcm-place${hlManualSet.has(`${item.entity_type}:${Number(item.id)}`) ? " is-manual" : ""}`}>
                          <div className="hcm-place-media">
                            {cover ? <img src={cover} alt="" onError={(e) => { e.target.style.display = "none"; }} /> : null}
                          </div>
                          <div className="hcm-place-info">
                            <span className="hcm-place-label">{item.category || ""}</span>
                            <span className="hcm-place-title">{item.title || "-"}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="hcm-section">
                  <p className="hcm-eyebrow">Situations</p>
                  <h4 className="hcm-heading">{scenariosBlock.title || "scenarios"}</h4>
                  <div className="hcm-situations">
                    {(previewSituations || []).map((s, si) => (
                      <article key={s.id || si} className={`hcm-sit${si === 0 ? " is-large" : ""}`}>
                        <h5 className="hcm-sit-title">{s.title || s.slug || "-"}</h5>
                        <p className="hcm-sit-desc">{s.description || ""}</p>
                        {(s.places || []).length > 0 ? (
                          <ol className="hcm-sit-list">
                            {(s.places || []).map((p, pi) => (
                              <li key={p.id || pi}>
                                <span className="hcm-sit-num">{String(pi + 1).padStart(2, "0")}</span>
                                <span>{p.title || "-"}</span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="hcm-sit-empty">ยังไม่ได้เลือกสถานที่</p>
                        )}
                      </article>
                    ))}
                  </div>
                </section>

                <section className="hcm-section">
                  <p className="hcm-eyebrow">Latest</p>
                  <h4 className="hcm-heading">{eventsBlock.title || "featured_events"}</h4>
                  <div className="hcm-events">
                    {evSlots[0] ? (
                      <div className={`hcm-event is-featured${evManualSet.has(`${evSlots[0].entity_type}:${Number(evSlots[0].id)}`) ? " is-manual" : ""}`}>
                        <div className="hcm-event-media">
                          {evSlots[0].image ? <img src={evSlots[0].image} alt="" onError={(e) => { e.target.style.display = "none"; }} /> : null}
                        </div>
                        <div className="hcm-event-panel"><h5>{evSlots[0].title || "-"}</h5></div>
                      </div>
                    ) : (
                      <div className="hcm-event is-featured is-empty" />
                    )}
                    <div className="hcm-events-grid">
                      {evSlots.slice(1, 5).map((item, i) => (
                        item ? (
                          <div key={`ev-${item.entity_type}-${item.id}-${i}`} className={`hcm-event${evManualSet.has(`${item.entity_type}:${Number(item.id)}`) ? " is-manual" : ""}`}>
                            <div className="hcm-event-media">
                              {item.image ? <img src={item.image} alt="" onError={(e) => { e.target.style.display = "none"; }} /> : null}
                            </div>
                            <div className="hcm-event-panel"><h5>{item.title || "-"}</h5></div>
                          </div>
                        ) : (
                          <div key={`ev-empty-${i}`} className="hcm-event is-empty" />
                        )
                      ))}
                    </div>
                  </div>
                </section>

                <div className="hcm-explore" />
              </div>
            );
          })()}
        </div>
      ) : activeTab === TAB_HIGHLIGHT ? (
        <div className="homepage-curation-block-list">
          {(() => {
            const highlightIndex = blocks.findIndex((b) => b.key === "highlight");
            if (highlightIndex < 0) return <p className="muted">ไม่พบบล็อกไฮไลต์</p>;
            const block = blocks[highlightIndex];
            return (
              <article className="homepage-curation-block-card">
                <div className="homepage-curation-block-head">
                  <div>
                    <p className="homepage-curation-block-kicker">{getBlockTypeLabel(block.type)}</p>
                    <h3>ไฮไลต์</h3>
                    <p className="muted">หัวข้อและคำโปรยบนหน้าเว็บกำหนดไว้ในโค้ด แก้ที่นี่ไม่ได้</p>
                  </div>
                </div>

                <div className="grid two homepage-curation-grid">
                  <label>
                    จำนวนรายการที่แสดง
                    <select value={block.max_items} onChange={(event) => updateBlock(highlightIndex, { max_items: Number(event.target.value) })}>
                      <option value={3}>3</option>
                      <option value={6}>6</option>
                      <option value={9}>9</option>
                    </select>
                  </label>
                  {block.manual_items.length > block.max_items ? (
                    <p className="homepage-curation-warning-text">
                      มีรายการทั้งหมด {block.manual_items.length} รายการ แต่จะแสดงจริง {block.max_items} รายการ — รายการส่วนเกินจะไม่แสดงบนหน้าแรก กรุณาลบรายการที่ไม่ต้องการออก
                    </p>
                  ) : null}
                </div>

                {renderBlockEditor(block, highlightIndex)}
              </article>
            );
          })()}
        </div>
      ) : activeTab === TAB_SITUATIONS ? (
        <div className="homepage-curation-block-list">
          {(() => {
            const scenariosIndex = blocks.findIndex((b) => b.key === "scenarios");
            if (scenariosIndex < 0) return null;
            const block = blocks[scenariosIndex];
            return (
              <article className="homepage-curation-block-card">
                <div className="homepage-curation-block-head">
                  <div>
                    <p className="homepage-curation-block-kicker">{getBlockTypeLabel(block.type)}</p>
                    <h3>{block.title || block.key}</h3>
                    <p className="muted">{block.key}</p>
                  </div>
                </div>

                <div className="grid two homepage-curation-grid">
                  <label>
                    ชื่อบล็อก
                    <input value={block.title} onChange={(event) => updateBlock(scenariosIndex, { title: event.target.value })} />
                  </label>
                  <label>
                    คำอธิบายย่อย
                    <input value={block.subtitle} onChange={(event) => updateBlock(scenariosIndex, { subtitle: event.target.value })} />
                  </label>
                  <label>
                    วิธีเลือกเนื้อหา
                    <select value={block.source_mode} onChange={(event) => updateBlock(scenariosIndex, { source_mode: event.target.value })}>
                      {SOURCE_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    รายการสำรอง
                    <select value={block.fallback_mode} onChange={(event) => updateBlock(scenariosIndex, { fallback_mode: event.target.value })}>
                      {FALLBACK_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    จำนวนขั้นต่ำ
                    <input type="number" min="0" value={block.min_items} onChange={(event) => updateBlock(scenariosIndex, { min_items: event.target.value })} />
                  </label>
                  <label>
                    จำนวนสูงสุด
                    <input type="number" min="0" value={block.max_items} onChange={(event) => updateBlock(scenariosIndex, { max_items: event.target.value })} />
                  </label>
                </div>

                <div className="homepage-curation-rule-panel">
                  <h4>ตั้งค่ากฎ</h4>
                  <div className="grid two">
                    <label>
                      ขอบเขตหมวดหมู่
                      <input
                        value={block.rule_config?.category_scope || ""}
                        onChange={(event) => updateRuleConfig(scenariosIndex, { category_scope: event.target.value })}
                        placeholder="เช่น attractions, cafes, restaurants"
                      />
                    </label>
                    <label>
                      แท็กสถานการณ์
                      <input
                        value={block.rule_config?.scenario_tags || ""}
                        onChange={(event) => updateRuleConfig(scenariosIndex, { scenario_tags: event.target.value })}
                        placeholder="เช่น day-trip, budget-500, family"
                      />
                    </label>
                    <label className="full">
                      วิธีเรียงลำดับ
                      <select value={block.rule_config?.sort_by || "featured_then_recent"} onChange={(event) => updateRuleConfig(scenariosIndex, { sort_by: event.target.value })}>
                        {SORT_BY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                {renderBlockEditor(block, scenariosIndex)}
              </article>
            );
          })()}
          <Situations token={token} />
        </div>
      ) : activeTab === TAB_HERO ? (
        <div className="homepage-curation-block-list">
          {(() => {
            const heroIndex = blocks.findIndex((b) => b.key === "hero");
            if (heroIndex < 0) return null;
            const heroBlock = blocks[heroIndex];
            return (
              <article className="homepage-curation-block-card">
                <div className="homepage-curation-block-head">
                  <div>
                    <p className="homepage-curation-block-kicker">ส่วนหัวหน้าแรก</p>
                    <h3>ข้อความ Hero</h3>
                  </div>
                </div>
                <div className="grid two homepage-curation-grid">
                  <label>
                    หัวข้อ
                    <input
                      value={heroBlock.title || ""}
                      onChange={(event) => updateBlock(heroIndex, { title: event.target.value })}
                    />
                  </label>
                  <label>
                    คำอธิบาย
                    <input
                      value={heroBlock.subtitle || ""}
                      onChange={(event) => updateBlock(heroIndex, { subtitle: event.target.value })}
                    />
                  </label>
                </div>
              </article>
            );
          })()}
          <h3>Shortcuts</h3>
          <Shortcuts token={token} />
        </div>
      ) : activeTab === TAB_EVENTS ? (
        <div className="homepage-curation-block-list">
          {(() => {
            const eventIndex = blocks.findIndex((b) => b.key === "featured_events");
            if (eventIndex < 0) return <p className="muted">ไม่พบบล็อกอีเวนต์</p>;
            const block = blocks[eventIndex];
            return (
              <article className="homepage-curation-block-card">
                <div className="homepage-curation-block-head">
                  <div>
                    <p className="homepage-curation-block-kicker">{getBlockTypeLabel(block.type)}</p>
                  </div>
                </div>

                <div className="grid two homepage-curation-grid">
                  <label>
                    ชื่อบล็อก
                    <input value={block.title} onChange={(event) => updateBlock(eventIndex, { title: event.target.value })} />
                  </label>
                  <label>
                    คำอธิบายย่อย
                    <input value={block.subtitle} onChange={(event) => updateBlock(eventIndex, { subtitle: event.target.value })} />
                  </label>
                </div>

                <p className="muted" style={{ marginBottom: "0.5rem" }}>ปักหมุดได้ 1 อีเวนต์ จะแสดงเป็นการ์ดใหญ่ ที่เหลืออีก 4 เรียงจากอีเวนต์ที่อนุมัติล่าสุดอัตโนมัติ</p>

                {renderBlockEditor(block, eventIndex)}
              </article>
            );
          })()}
        </div>
      ) : (
        <div className="homepage-curation-block-list">
          <article className="homepage-curation-block-card">
            <div className="homepage-curation-block-head">
              <div>
                <p className="homepage-curation-block-kicker">Signals / Content Pool</p>
                <h3>สัญญาณและกลุ่มคอนเทนต์</h3>
                <p className="muted">
                  ใช้แท็บนี้เพื่อรีวิวรายการที่อาจนำไปคัดเลือกบนหน้าแรกเท่านั้น ไม่ใช่หน้าสำหรับแก้ไขเนื้อหา อนุมัติ เผยแพร่ หรือสั่ง AI
                </p>
              </div>
            </div>

            <div className="homepage-curation-rule-panel">
              <p className="muted">
                เลือก situation หรือ shortcut แล้วกดเพิ่ม ระบบบันทึกทันที
              </p>
              <div className="grid two">
                <label>
                  ประเภทรายการ
                  <select
                    value={poolState.entity_type}
                    onChange={(event) => {
                      setPoolState((current) => applyPoolEntityTypeChange(current, event.target.value));
                      setPoolSelectedCandidateKeys([]);
                    }}
                  >
                    {ENTITY_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value} disabled={option.value === "event"}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  ค้นหารายการ
                  <input
                    value={poolState.q}
                    onChange={(event) => updatePoolState({ q: event.target.value })}
                    placeholder={poolState.entity_type === "event" ? "ค้นหาชื่ออีเวนต์" : "ค้นหาด้วยชื่อหรือ slug"}
                  />
                </label>
                {poolState.entity_type === "place" ? (
                  <div className="full approvals-summary-grid">
                    {[0, 1, 2].map((slotIndex) => (
                      <label key={`taxonomy-slot-${slotIndex}`}>
                        คุณสมบัติ {slotIndex + 1}
                        <select
                          value={poolState.taxonomy_true[slotIndex] || ""}
                          onChange={(event) => updatePoolState({
                            taxonomy_true: updateTaxonomyLookupSlot(poolState.taxonomy_true, slotIndex, event.target.value),
                            items: [],
                            error: "",
                          })}
                          disabled={Boolean(taxonomyCatalogError)}
                        >
                          <option value="">ไม่เลือก</option>
                          {taxonomyCatalog.map((entry) => (
                            <option
                              key={entry.key}
                              value={entry.key}
                              disabled={poolState.taxonomy_true.some((selectedKey, selectedIndex) => selectedIndex !== slotIndex && selectedKey === entry.key)}
                            >
                              {entry.label} ({entry.key})
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                ) : null}
                <fieldset className="full">
                  <legend>Situation</legend>
                  {situationsList.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {situationsList.map((s) => (
                        <button
                          key={s.slug}
                          type="button"
                          className={selectedSituationSlugs.includes(s.slug) ? "primary" : "ghost"}
                          onClick={() => {
                            setSelectedSituationSlugs((current) =>
                              current.includes(s.slug)
                                ? current.filter((x) => x !== s.slug)
                                : [...current, s.slug]
                            );
                          }}
                        >
                          {s.title || s.slug}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="muted">ไม่มี situation</span>
                  )}
                </fieldset>
                <fieldset className="full">
                  <legend>Shortcut</legend>
                  {shortcutsList.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {shortcutsList.map((s) => (
                        <button
                          key={s.slug}
                          type="button"
                          className={selectedShortcutSlugs.includes(s.slug) ? "primary" : "ghost"}
                          onClick={() => {
                            setSelectedShortcutSlugs((current) =>
                              current.includes(s.slug)
                                ? current.filter((x) => x !== s.slug)
                                : [...current, s.slug]
                            );
                          }}
                        >
                          {s.title || s.slug}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="muted">ไม่มี Shortcut</span>
                  )}
                </fieldset>
              </div>

              {taxonomyCatalogError ? <p className="status">{taxonomyCatalogError}</p> : null}
              <div className="actions">
                <button type="button" className="ghost" onClick={searchPoolCandidates} disabled={poolState.loading}>
                  {poolState.loading ? "กำลังค้นหา..." : "ค้นหารายการ"}
                </button>
              </div>
            </div>

            {poolState.error ? <p className="status">{poolState.error}</p> : null}
            {!poolState.loading && !poolState.error && poolState.items.length === 0 ? (
              <p className="muted">ยังไม่พบรายการ หรือยังไม่มีคอนเทนต์ในกลุ่มนี้</p>
            ) : null}

            {poolState.items.length ? (
              <>
                <div className="actions">
                  <span className="muted">เลือกแล้ว {selectedPoolCandidates.length} รายการ</span>
                  <button
                    type="button"
                    className="primary"
                    onClick={addSelectedPoolCandidatesToSituations}
                    disabled={!selectedSituationSlugs.length || !selectedPoolCandidates.length}
                  >
                    เพิ่มรายการที่เลือกเข้า situation
                  </button>
                  {poolSituationStatus ? <span className="muted">{poolSituationStatus}</span> : null}
                  <button
                    type="button"
                    className="primary"
                    onClick={addSelectedPoolCandidatesToShortcuts}
                    disabled={!selectedShortcutSlugs.length || !selectedPoolCandidates.length}
                  >
                    เพิ่มรายการที่เลือกเข้า Shortcut
                  </button>
                  {poolShortcutStatus ? <span className="muted">{poolShortcutStatus}</span> : null}
                </div>
                <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={poolState.items.length > 0 && poolState.items.every((candidate) => poolSelectedCandidateKeys.includes(candidateSelectionKey(candidate)))}
                          onChange={() => setPoolSelectedCandidateKeys((current) => selectCurrentCandidateRows(poolState.items, current))}
                          aria-label="เลือกทั้งหมดในหน้าปัจจุบัน"
                        />
                      </th>
                      <th>ชื่อ</th>
                      <th>หมวดหมู่/ประเภท</th>
                      <th>คุณสมบัติที่ตรง</th>
                      <th>อัปเดตล่าสุด</th>
                      <th>การทำงาน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poolState.items.map((candidate) => {
                      const key = candidateSelectionKey(candidate);
                      const matches = Object.entries(candidate.taxonomy_summary || {})
                        .filter(([, value]) => value === true)
                        .map(([taxonomyKey]) => taxonomyCatalog.find((entry) => entry.key === taxonomyKey)?.label || taxonomyKey)
                        .join(", ");
                      return (
                        <tr key={`pool-${candidate.entity_type}-${candidate.id}`}>
                          <td>
                            <input
                              type="checkbox"
                              checked={poolSelectedCandidateKeys.includes(key)}
                              onChange={() => setPoolSelectedCandidateKeys((current) => toggleCandidateSelection(current, candidate))}
                              aria-label={`เลือกรายการ ${candidate.title || candidate.id}`}
                            />
                          </td>
                          <td>{candidate.title || "-"}</td>
                          <td>{candidate.category || getEntityTypeLabel(candidate.entity_type)}</td>
                          <td>{matches || "-"}</td>
                          <td>{candidate.updated_at ? new Date(candidate.updated_at).toLocaleString() : "-"}</td>
                          <td>
                            <button
                              type="button"
                              className="ghost tiny-btn"
                              onClick={() => addPoolCandidateToSituations(candidate)}
                              disabled={!selectedSituationSlugs.length || String(candidate.entity_type || "").toLowerCase() !== "place"}
                            >
                              เพิ่มเข้า situation
                            </button>{" "}
                            <button
                              type="button"
                              className="ghost tiny-btn"
                              onClick={() => addPoolCandidateToShortcuts(candidate)}
                              disabled={!selectedShortcutSlugs.length || String(candidate.entity_type || "").toLowerCase() !== "place"}
                            >
                              เพิ่มเข้า Shortcut
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </>
            ) : null}
          </article>
        </div>
      )}
    </section>
  );
}
