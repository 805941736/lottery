export const snapLinePoint = (start, point) => {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!length) return point;
  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return { x: start.x + Math.cos(snappedAngle) * length, y: start.y + Math.sin(snappedAngle) * length };
};

export const rectFromPoints = (start, end) => ({
  x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
  w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y)
});

export const createAnnotationRenderer = (defaultContext) => {
  const drawLine = (context, start, end) => {
    context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(end.x, end.y); context.stroke();
  };
  const drawArrowHead = (context, start, end, width) => {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const size = Math.max(12, width * 4);
    context.beginPath(); context.moveTo(end.x, end.y);
    context.lineTo(end.x - size * Math.cos(angle - Math.PI / 6), end.y - size * Math.sin(angle - Math.PI / 6));
    context.lineTo(end.x - size * Math.cos(angle + Math.PI / 6), end.y - size * Math.sin(angle + Math.PI / 6));
    context.closePath(); context.fill();
  };
  const drawAction = (action, context = defaultContext) => {
    context.save();
    context.lineWidth = action.width; context.strokeStyle = action.color; context.fillStyle = action.color;
    context.lineCap = "round"; context.lineJoin = "round";
    if (action.type === "pen") {
      const points = action.points || [];
      if (points.length === 1) {
        context.beginPath(); context.arc(points[0].x, points[0].y, action.width / 2, 0, Math.PI * 2); context.fill();
      } else if (points.length > 1) {
        context.beginPath(); context.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
        context.stroke();
      }
    }
    if (action.type === "line" || action.type === "arrow") {
      drawLine(context, action.start, action.end);
      if (action.type === "arrow") drawArrowHead(context, action.start, action.end, action.width);
    }
    if (action.type === "rect") {
      const rect = rectFromPoints(action.start, action.end);
      context.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
    if (action.type === "ellipse") {
      const rect = rectFromPoints(action.start, action.end);
      context.beginPath();
      context.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.abs(rect.w / 2), Math.abs(rect.h / 2), 0, 0, Math.PI * 2);
      context.stroke();
    }
    if (action.type === "text") {
      context.font = `${Math.max(14, action.width * 4)}px "Microsoft YaHei", Arial, sans-serif`;
      context.textBaseline = "top";
      String(action.text || "").split("\n").forEach((line, index) => context.fillText(line, action.x, action.y + index * Math.max(18, action.width * 5)));
    }
    context.restore();
  };
  return Object.freeze({ drawAction });
};
