export const createAnnotationModel = ({ context, normalizeBounds, pointsBounds, scalePoint }) => {
  const cloneAction = (action) => JSON.parse(JSON.stringify(action));
  const textBounds = (action) => {
    const fontSize = Math.max(14, action.width * 4);
    const lineHeight = Math.max(18, action.width * 5);
    const lines = String(action.text || "").split("\n");
    context.save();
    context.font = `${fontSize}px "Microsoft YaHei", Arial, sans-serif`;
    const metrics = [context.measureText("一"), ...lines.map((line) => context.measureText(line || " "))];
    const width = Math.max(...metrics.map((item) => item.width));
    const glyphHeight = Math.max(fontSize * .9, ...metrics.map((item) => (item.actualBoundingBoxAscent || 0) + (item.actualBoundingBoxDescent || 0)));
    context.restore();
    const pad = Math.max(1, action.width * .12);
    return { x: action.x - pad, y: action.y - pad, w: width + pad * 2, h: glyphHeight + Math.max(0, lines.length - 1) * lineHeight + pad * 2 };
  };
  const actionBounds = (action) => {
    if (!action) return null;
    if (action.type === "pen") return pointsBounds(action.points || []);
    if (["line", "arrow", "rect", "ellipse"].includes(action.type)) {
      return normalizeBounds({ x: action.start.x, y: action.start.y, w: action.end.x - action.start.x, h: action.end.y - action.start.y });
    }
    return action.type === "text" ? textBounds(action) : null;
  };
  const moveAction = (action, dx, dy) => {
    if (action.type === "pen") action.points.forEach((point) => { point.x += dx; point.y += dy; });
    if (action.start) { action.start.x += dx; action.start.y += dy; }
    if (action.end) { action.end.x += dx; action.end.y += dy; }
    if (action.type === "text") { action.x += dx; action.y += dy; }
  };
  const scaleAction = (action, fromBounds, toBounds) => {
    const from = normalizeBounds(fromBounds);
    const to = normalizeBounds(toBounds);
    if (action.type === "pen") action.points = action.points.map((point) => scalePoint(point, from, to));
    if (action.start) action.start = scalePoint(action.start, from, to);
    if (action.end) action.end = scalePoint(action.end, from, to);
    if (action.type === "text") {
      const next = scalePoint({ x: action.x, y: action.y }, from, to);
      action.x = next.x; action.y = next.y;
      action.width = Math.max(1, action.width * Math.max(to.w / Math.max(1, from.w), to.h / Math.max(1, from.h)));
    }
  };
  const scaleTextAction = (action, fromBounds, toBounds, handle) => {
    const from = normalizeBounds(fromBounds);
    const to = normalizeBounds(toBounds);
    action.width = Math.max(1, action.width * Math.max(to.w / Math.max(1, from.w), to.h / Math.max(1, from.h)));
    const next = actionBounds(action);
    const fixedX = handle.includes("w") ? from.x + from.w : from.x;
    const fixedY = handle.includes("n") ? from.y + from.h : from.y;
    const currentX = handle.includes("w") ? next.x + next.w : next.x;
    const currentY = handle.includes("n") ? next.y + next.h : next.y;
    moveAction(action, fixedX - currentX, fixedY - currentY);
  };
  return Object.freeze({ actionBounds, cloneAction, moveAction, scaleAction, scaleTextAction, textBounds });
};
