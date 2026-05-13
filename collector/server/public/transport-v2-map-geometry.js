export function resolveViewbox(viewbox, fallback = { x: 0, y: 0, width: 1, height: 1 }) {
  const source = viewbox && typeof viewbox === "object" ? viewbox : fallback;
  const width = Math.max(1, Number(source?.width || fallback?.width || 1) || 1);
  const height = Math.max(1, Number(source?.height || fallback?.height || 1) || 1);
  return {
    x: Number(source?.x || fallback?.x || 0) || 0,
    y: Number(source?.y || fallback?.y || 0) || 0,
    width,
    height,
  };
}

export function computeBaseRenderedImageRect(stageRect, viewbox, fallbackViewbox) {
  if (!stageRect?.width || !stageRect?.height) return null;
  const resolvedViewbox = resolveViewbox(viewbox, fallbackViewbox);
  const imageRatio = resolvedViewbox.width / resolvedViewbox.height;
  const stageRatio = stageRect.width / stageRect.height;
  let renderWidth = stageRect.width;
  let renderHeight = stageRect.height;
  if (stageRatio > imageRatio) {
    renderHeight = stageRect.height;
    renderWidth = renderHeight * imageRatio;
  } else {
    renderWidth = stageRect.width;
    renderHeight = renderWidth / imageRatio;
  }
  return {
    left: stageRect.left + ((stageRect.width - renderWidth) / 2),
    top: stageRect.top + ((stageRect.height - renderHeight) / 2),
    width: renderWidth,
    height: renderHeight,
  };
}

export function computeRenderedImageRect(stageRect, viewbox, viewport = {}, fallbackViewbox) {
  const baseRect = computeBaseRenderedImageRect(stageRect, viewbox, fallbackViewbox);
  if (!baseRect || !stageRect) return null;
  const scale = Math.max(1, Number(viewport?.scale || 1) || 1);
  const offsetX = Number(viewport?.offsetX || 0) || 0;
  const offsetY = Number(viewport?.offsetY || 0) || 0;
  const stageCenterX = stageRect.left + (stageRect.width / 2);
  const stageCenterY = stageRect.top + (stageRect.height / 2);
  const width = baseRect.width * scale;
  const height = baseRect.height * scale;
  return {
    left: stageCenterX + ((baseRect.left - stageCenterX) * scale) + offsetX,
    top: stageCenterY + ((baseRect.top - stageCenterY) * scale) + offsetY,
    width,
    height,
  };
}

export function mapPointToStagePercent(anchorX, anchorY, viewbox, stageRect, baseRect, fallbackViewbox) {
  const resolvedViewbox = resolveViewbox(viewbox, fallbackViewbox);
  const normalizedX = Math.max(0, Math.min(1, (Number(anchorX || 0) - resolvedViewbox.x) / resolvedViewbox.width));
  const normalizedY = Math.max(0, Math.min(1, (Number(anchorY || 0) - resolvedViewbox.y) / resolvedViewbox.height));
  if (!stageRect?.width || !stageRect?.height || !baseRect?.width || !baseRect?.height) {
    return {
      left: normalizedX * 100,
      top: normalizedY * 100,
    };
  }
  const insetLeft = baseRect.left - stageRect.left;
  const insetTop = baseRect.top - stageRect.top;
  const leftPx = insetLeft + (normalizedX * baseRect.width);
  const topPx = insetTop + (normalizedY * baseRect.height);
  return {
    left: (leftPx / stageRect.width) * 100,
    top: (topPx / stageRect.height) * 100,
  };
}

export function mapSizeToStagePercent(widthValue, heightValue, viewbox, stageRect, baseRect, fallbackViewbox) {
  const resolvedViewbox = resolveViewbox(viewbox, fallbackViewbox);
  const normalizedWidth = Math.max(0, Number(widthValue || 0) / resolvedViewbox.width);
  const normalizedHeight = Math.max(0, Number(heightValue || 0) / resolvedViewbox.height);
  if (!stageRect?.width || !stageRect?.height || !baseRect?.width || !baseRect?.height) {
    return {
      width: normalizedWidth * 100,
      height: normalizedHeight * 100,
    };
  }
  return {
    width: (((normalizedWidth * baseRect.width) / stageRect.width) * 100),
    height: (((normalizedHeight * baseRect.height) / stageRect.height) * 100),
  };
}

export function projectBoundsPointToStagePercent(point, bounds, stageRect, baseRect) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  const minLat = Number(bounds?.min_lat);
  const maxLat = Number(bounds?.max_lat);
  const minLng = Number(bounds?.min_lng);
  const maxLng = Number(bounds?.max_lng);
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  if (![lat, lng, minLat, maxLat, minLng, maxLng].every(Number.isFinite) || !latSpan || !lngSpan) {
    return null;
  }
  return mapPointToStagePercent(
    ((lng - minLng) / lngSpan) * 100,
    (1 - ((lat - minLat) / latSpan)) * 100,
    { width: 100, height: 100 },
    stageRect,
    baseRect,
    { width: 100, height: 100 }
  );
}
