import Link from "next/link";

export default function HoverCoverCard({
  href,
  imageSrc,
  eyebrow,
  title,
  description,
  meta,
  cta,
  className = "",
}) {
  return (
    <Link href={href} className={`content-hover-card ${className}`.trim()}>
      <article className="content-hover-card__surface">
        <div
          className="content-hover-card__img"
          style={{ backgroundImage: `url('${imageSrc}')` }}
          aria-hidden="true"
        />
        <div
          className="content-hover-card__img-hover"
          style={{ backgroundImage: `url('${imageSrc}')` }}
          aria-hidden="true"
        />

        {(eyebrow || meta) ? (
          <div className="content-hover-card__info-hover">
            <div className="content-hover-card__hover-row">
              {eyebrow ? <span className="content-hover-card__hover-category">{eyebrow}</span> : <span />}
              {meta ? <span className="content-hover-card__hover-meta">{meta}</span> : null}
            </div>
          </div>
        ) : null}

        <div className="content-hover-card__info">
          {eyebrow ? <p className="content-hover-card__category">{eyebrow}</p> : null}
          <h2 className="content-hover-card__title">{title}</h2>
          {description ? <p className="content-hover-card__description">{description}</p> : null}

          {(cta || meta) ? (
            <div className="content-hover-card__footer">
              {cta ? <span className="content-hover-card__cta">{cta}</span> : <span />}
              {meta ? <span className="content-hover-card__meta">{meta}</span> : null}
            </div>
          ) : null}
        </div>
      </article>
    </Link>
  );
}
