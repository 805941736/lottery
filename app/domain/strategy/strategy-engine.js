export const topNumbersByScore = (scores, count) => scores
  .sort((a, b) => b.score - a.score || a.number - b.number)
  .slice(0, count)
  .map((item) => item.number)
  .sort((a, b) => a - b);
export const buildNumberStats = (historyRows) => {
  const redStats = Array.from({ length: 34 }, (_, number) => ({ number, freq: 0, recentFreq: 0, miss: historyRows.length, lastIndex: -1, score: 0, reasons: [] }));
  const blueStats = Array.from({ length: 17 }, (_, number) => ({ number, freq: 0, recentFreq: 0, miss: historyRows.length, lastIndex: -1, score: 0, reasons: [] }));
  const recentStart = Math.max(0, historyRows.length - 12);
  historyRows.forEach((row, index) => {
    row.red.map(Number).forEach((number) => {
      if (!redStats[number]) return;
      redStats[number].freq += 1;
      if (index >= recentStart) redStats[number].recentFreq += 1;
      redStats[number].lastIndex = index;
    });
    const blue = Number(row.blue);
    if (blueStats[blue]) {
      blueStats[blue].freq += 1;
      if (index >= recentStart) blueStats[blue].recentFreq += 1;
      blueStats[blue].lastIndex = index;
    }
  });
  redStats.slice(1).forEach((item) => { item.miss = item.lastIndex < 0 ? historyRows.length : historyRows.length - item.lastIndex - 1; });
  blueStats.slice(1).forEach((item) => { item.miss = item.lastIndex < 0 ? historyRows.length : historyRows.length - item.lastIndex - 1; });
  return { redStats, blueStats };
};
const addScore = (item, value, reason) => {
  item.score += value;
  if (value > 0) item.reasons.push(`${reason}+${value.toFixed(1)}`);
};
export const inferStrategyMode = (strategy) => {
  if (strategy.mode) return strategy.mode;
  const text = `${strategy.name || ""} ${strategy.explain || ""} ${strategy.example || ""}`;
  if (/重号|复现|重复|上期.*开/.test(text)) return "repeat";
  if (/邻号|相邻|前后|斜连|贴边|边号/.test(text)) return "neighbor";
  if (/冷号|遗漏|回补|久未|补位/.test(text)) return "miss";
  if (/分区|三区|一区|二区|三区|均衡|区间/.test(text)) return "zone";
  if (/热号|高频|频繁|连热|近期.*多/.test(text)) return "hot";
  return "hot";
};
const strategyLabel = (strategy) => {
  const mode = inferStrategyMode(strategy);
  return { hot: "热号模型", repeat: "重号模型", neighbor: "邻号模型", miss: "遗漏模型", zone: "分区模型" }[mode] || "热号模型";
};
const redZone = (number) => {
  const target = Number(number);
  if (!Number.isFinite(target) || target < 1) return 0;
  if (target <= 11) return 0;
  if (target <= 22) return 1;
  return 2;
};
const scoreCandidate = (stats, number, max, value, reason) => {
  const target = Number(number);
  if (target >= 1 && target <= max && stats[target]) addScore(stats[target], value, reason);
};
const latestRedSet = (row) => new Set((row?.red || []).map(Number));
const penalizeLatestNumbers = (latest, redStats, blueStats, weight, label) => {
  if (!latest) return;
  latest.red.map(Number).forEach((number) => { if (redStats[number]) redStats[number].score -= 2.8 * weight; });
  if (blueStats[Number(latest.blue)]) blueStats[Number(latest.blue)].score -= 1.6 * weight;
};
const applyStrategyMode = (mode, strategy, historyRows, redStats, blueStats, predictionLines) => {
  const latest = historyRows.at(-1);
  const previous = historyRows.at(-2);
  const weight = Number(strategy.weight) || 1;
  const label = strategy.name?.trim() || strategyLabel(strategy);
  const recent = historyRows.slice(-12);
  const longRecent = historyRows.slice(-30);
  const latestSet = latestRedSet(latest);
  const addRed = (number, value) => scoreCandidate(redStats, number, 33, value * weight, label);
  const addBlue = (number, value) => scoreCandidate(blueStats, number, 16, value * weight, label);
  const addLatestNeighbors = (value = 2.4) => {
    if (!latest) return;
    latest.red.map(Number).forEach((number) => [number - 2, number - 1, number + 1, number + 2].forEach((near) => addRed(near, value / (Math.abs(near - number) || 1))));
    [Number(latest.blue) - 1, Number(latest.blue) + 1].forEach((near) => addBlue(near, value * 0.7));
  };
  if (strategy.id === "short-trend" || mode === "hot") {
    redStats.slice(1).forEach((item) => addScore(item, (item.recentFreq * 1.3 + item.freq * 0.12 + Math.max(0, 8 - item.miss) * 0.18) * weight, label));
    blueStats.slice(1).forEach((item) => addScore(item, (item.recentFreq * 1.1 + item.freq * 0.1 + Math.max(0, 6 - item.miss) * 0.16) * weight, label));
  }
  if (strategy.id === "similar-backtrack") {
    if (latest) {
      const latestZones = latest.red.map(Number).map(redZone).join("");
      historyRows.slice(0, -1).forEach((row, index) => {
        const zoneMatch = row.red.map(Number).map(redZone).join("") === latestZones;
        const overlap = row.red.map(Number).filter((number) => latestSet.has(number)).length;
        const next = historyRows[index + 1];
        if (next && (zoneMatch || overlap >= 2) && next.issue !== latest.issue) {
          next.red.map(Number).forEach((number) => addRed(number, zoneMatch ? 1.9 : 1.2));
          addBlue(Number(next.blue), zoneMatch ? 1.1 : 0.7);
        }
      });
    }
  }
  if (strategy.id === "hot-cycle" || strategy.id === "group-shape" || mode === "zone") {
    const zoneHits = [0, 0, 0];
    recent.forEach((row) => row.red.map(Number).forEach((number) => { zoneHits[redZone(number)] += 1; }));
    const sortedZones = [0, 1, 2].sort((a, b) => zoneHits[a] - zoneHits[b]);
    redStats.slice(1).forEach((item) => {
      const zoneRank = sortedZones.indexOf(redZone(item.number));
      addScore(item, (1.2 + zoneRank * 0.35 + Math.min(item.miss, 16) * 0.08) * weight, label);
    });
  }
  if (strategy.id === "expect-pair" || strategy.id === "shape-turn" || strategy.id === "odd-extend" || mode === "neighbor") addLatestNeighbors(strategy.id === "odd-extend" ? 2.9 : 2.2);
  if (strategy.id === "shape-map") {
    if (latest) latest.red.map(Number).forEach((number) => [-11, -10, 10, 11].forEach((offset) => addRed(number + offset, 2.1)));
    if (latest) [Number(latest.blue) + 4, Number(latest.blue) - 4].forEach((number) => addBlue(number, 1.1));
  }
  if (strategy.id === "vertical-gap" || mode === "repeat") {
    redStats.slice(1).forEach((item) => {
      const hits = longRecent.map((row, index) => row.red.map(Number).includes(item.number) ? index : -1).filter((index) => index >= 0);
      if (hits.length >= 2) {
        const gap = hits.at(-1) - hits.at(-2);
        const due = gap > 0 && longRecent.length - 1 - hits.at(-1) >= Math.max(1, gap - 1);
        if (due) addScore(item, 2.4 * weight, label);
      }
    });
  }
  if (strategy.id === "mirror-shape") {
    if (latest) latest.red.map(Number).forEach((number) => addRed(34 - number, 2.2));
    if (latest) addBlue(17 - Number(latest.blue), 1.3);
  }
  if (strategy.id === "fixed-pair") {
    [28, 29, 31, 32, 33].forEach((number) => addRed(number, 1.8));
    if (previous) previous.red.map(Number).filter((number) => number >= 28).forEach((number) => addRed(number - 1, 1.2));
  }
  if (strategy.id === "edge-swap") {
    if (latestSet.has(1)) addRed(33, 2.8);
    if (latestSet.has(33)) addRed(1, 2.8);
    if (latest && Number(latest.blue) <= 3) addBlue(16, 1.6);
    if (latest && Number(latest.blue) >= 14) addBlue(1, 1.6);
  }
  if (strategy.id === "random-hint") {
    [1, 2, 3].forEach((line) => {
      (predictionLines[line]?.red || []).forEach((number) => [number - 1, number, number + 1].forEach((candidate) => addRed(candidate, candidate === number ? 1.2 : 1.6)));
      (predictionLines[line]?.blue || []).forEach((number) => [number - 1, number, number + 1].forEach((candidate) => addBlue(candidate, candidate === number ? 0.8 : 1.0)));
    });
  }
  penalizeLatestNumbers(latest, redStats, blueStats, weight, label);
};
export const applyStrategyScores = ({ historyRows, redStats, blueStats, strategyIds, strategyLibrary, predictionLines, isAiStrategy }) => {
  const activeStrategies = strategyLibrary.filter((strategy) => strategyIds.includes(strategy.id) && !isAiStrategy(strategy));
  activeStrategies.forEach((strategy) => applyStrategyMode(inferStrategyMode(strategy), strategy, historyRows, redStats, blueStats, predictionLines));
};
