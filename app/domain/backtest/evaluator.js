const uniqueSorted = (items, max) => [...new Set((items || []).map(Number)
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= max))]
  .sort((a, b) => a - b);

export const normalizeBacktestRecord = (record) => ({
  red: uniqueSorted(record?.red, 33).slice(0, 6),
  blue: uniqueSorted(record?.blue, 16).slice(0, 1),
  source: record?.source || "已保存预测",
  savedAt: record?.savedAt || ""
});

export const evaluateBacktestPick = (pick, row) => {
  const redSet = new Set(row.red.map(Number));
  const blueNumber = Number(row.blue);
  const redHits = pick.red.filter((number) => redSet.has(number));
  const blueHits = pick.blue.filter((number) => number === blueNumber);
  return { redHits, blueHits, totalHits: redHits.length + blueHits.length };
};

const percentText = (value) => `${(value * 100).toFixed(1)}%`;

export const summarizeBacktestResults = (results) => {
  const denominator = results.length || 1;
  const avgRedHits = results.reduce((sum, item) => sum + item.redHits.length, 0) / denominator;
  const avgBlueHits = results.reduce((sum, item) => sum + item.blueHits.length, 0) / denominator;
  const avgTotalHits = results.reduce((sum, item) => sum + item.totalHits, 0) / denominator;
  return {
    issueCount: results.length,
    redHitRate: percentText(avgRedHits / 6),
    blueHitRate: percentText(avgBlueHits),
    redAvgHits: avgRedHits.toFixed(2),
    blueAvgHits: avgBlueHits.toFixed(2),
    avgTotalHits: avgTotalHits.toFixed(2),
    strongIssues: results.filter((item) => item.totalHits >= 3).length
  };
};
