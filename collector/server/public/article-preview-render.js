const TH_EMPTY = "ยังไม่ได้ระบุ";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function renderValueRow(label, value, href = "") {
  const display = normalizeString(value) || TH_EMPTY;
  const safeHref = normalizeString(href);
  return `
    <div class="summary-row">
      <strong>${escapeHtml(label)}</strong>
      <span>${safeHref ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(display)}</a>` : escapeHtml(display)}</span>
    </div>
  `;
}

function otherTransportSubtypeLabel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "taxi") return "Taxi";
  if (normalized === "rental") return "Rental";
  if (normalized === "shuttle") return "Shuttle";
  if (normalized === "other") return "Other";
  return normalizeString(value);
}

export function primaryCtaLabelTh(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "map") return "แผนที่";
  if (normalized === "phone") return "โทร";
  if (normalized === "line") return "LINE";
  return TH_EMPTY;
}

function renderGallerySection(galleryAssets = []) {
  const gallery = Array.isArray(galleryAssets) ? galleryAssets.filter((url) => normalizeString(url)) : [];
  return gallery.length ? `
    <div class="preview-gallery">
      ${gallery.map((url, index) => `
        <button type="button" class="preview-gallery-item${index === 0 ? " is-featured" : ""}${index % 5 === 2 ? " is-tall" : ""}" data-full-url="${escapeHtml(url)}" data-alt="gallery image ${index + 1}">
          <span class="preview-gallery-item-frame">
            <img src="${escapeHtml(url)}" alt="gallery image ${index + 1}" />
          </span>
        </button>
      `).join("")}
    </div>
  ` : `<p class="muted">${TH_EMPTY}</p>`;
}

export function buildRuntimeArticlePreviewModel({
  title = "",
  excerpt = "",
  bodyHtml = "",
  slug = "",
  hero = "",
  galleryAssets = [],
  metaTitle = "",
  metaDescription = "",
  ctaContact = {},
  isOtherTransport = false,
  otherTransportMeta = {},
} = {}) {
  const safeTitle = normalizeString(title) || "ยังไม่มีชื่อบทความ";
  const safeExcerpt = normalizeString(excerpt) || TH_EMPTY;
  const safeSlug = normalizeString(slug);
  const safeHero = normalizeString(hero);

  const contactSection = isOtherTransport
    ? `
      <section class="preview-gallery-section">
        <h3 class="preview-gallery-title">ช่องทางติดต่อ</h3>
        <div class="readiness-summary">
          ${renderValueRow("ประเภท", otherTransportMeta?.subtype_label || otherTransportSubtypeLabel(otherTransportMeta?.subtype))}
          ${renderValueRow("ผู้ติดต่อ", otherTransportMeta?.contact_name)}
          ${renderValueRow("เบอร์โทร", otherTransportMeta?.phone)}
          ${renderValueRow("ลิงก์", otherTransportMeta?.link_url, otherTransportMeta?.link_url)}
          ${renderValueRow("ช่องทางติดต่อ", otherTransportMeta?.contact_details)}
        </div>
      </section>
    `
    : `
      <section class="preview-gallery-section">
        <h3 class="preview-gallery-title">CTA / ช่องทางติดต่อ</h3>
        <div class="readiness-summary">
          ${renderValueRow("ปุ่ม CTA หลัก", primaryCtaLabelTh(ctaContact?.primary_cta))}
          ${renderValueRow("เบอร์โทร", ctaContact?.phone)}
          ${renderValueRow("ลิงก์ LINE", ctaContact?.line_url, ctaContact?.line_url)}
          ${renderValueRow("ลิงก์ Facebook", ctaContact?.facebook_url, ctaContact?.facebook_url)}
          ${renderValueRow("ลิงก์เว็บไซต์", ctaContact?.website_url, ctaContact?.website_url)}
        </div>
      </section>
    `;

  return `
    <section>
      <p class="muted">เนื้อหาบทความ</p>
      ${safeHero ? `<img class="preview-cover" src="${escapeHtml(safeHero)}" alt="ภาพปกบทความ" />` : ""}
      <h2 class="preview-title">${escapeHtml(safeTitle)}</h2>
      <p class="preview-excerpt">${escapeHtml(safeExcerpt)}</p>
      <div class="readiness-summary">
        ${renderValueRow("Slug", safeSlug)}
      </div>
      <div class="preview-body">${bodyHtml || `<p>${TH_EMPTY}</p>`}</div>
    </section>

    <section class="preview-gallery-section">
      <h3 class="preview-gallery-title">SEO</h3>
      <div class="readiness-summary">
        ${renderValueRow("ชื่อ SEO", metaTitle)}
        ${renderValueRow("คำอธิบาย SEO", metaDescription)}
      </div>
    </section>

    ${contactSection}

    <section class="preview-gallery-section">
      <h3 class="preview-gallery-title">รูปภาพ / สื่อ</h3>
      ${renderGallerySection(galleryAssets)}
    </section>
  `;
}

export function buildArticlePreviewHtml(options = {}) {
  return buildRuntimeArticlePreviewModel(options);
}
