(() => {
  const normalizeBounds = (bounds) => ({ x: Math.min(bounds.x, bounds.x + bounds.w), y: Math.min(bounds.y, bounds.y + bounds.h), w: Math.abs(bounds.w), h: Math.abs(bounds.h) });
  const pointsBounds = (points) => {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const scalePoint = (point, from, to) => ({
    x: to.x + ((point.x - from.x) / Math.max(1, from.w)) * Math.max(1, to.w),
    y: to.y + ((point.y - from.y) / Math.max(1, from.h)) * Math.max(1, to.h)
  });
  const pointInBounds = (point, bounds, pad = 0) => Boolean(bounds) && point.x >= bounds.x - pad && point.x <= bounds.x + bounds.w + pad && point.y >= bounds.y - pad && point.y <= bounds.y + bounds.h + pad;
  const boundsFromHandle = (bounds, handle, point) => {
    const next = { ...bounds };
    if (handle.includes("n")) { next.h = bounds.y + bounds.h - point.y; next.y = point.y; }
    if (handle.includes("s")) next.h = point.y - bounds.y;
    if (handle.includes("w")) { next.w = bounds.x + bounds.w - point.x; next.x = point.x; }
    if (handle.includes("e")) next.w = point.x - bounds.x;
    return normalizeBounds(next);
  };
  window.SSQAnnotationGeometry = Object.freeze({ normalizeBounds, pointsBounds, scalePoint, pointInBounds, boundsFromHandle });
})();
