export const createBacktestView = ({ formatPick }) => {
  const renderBacktestStats = (summary) => `<div class="backtest-grid"><div class="backtest-stat"><strong>回测期数</strong><br>${summary.issueCount}</div><div class="backtest-stat"><strong>红球平均命中率</strong><br><span class="backtest-stat-line"><span>${summary.redHitRate}</span><span class="backtest-stat-extra">平均${summary.redAvgHits}中</span></span></div><div class="backtest-stat"><strong>蓝球平均命中率</strong><br><span class="backtest-stat-line"><span>${summary.blueHitRate}</span><span class="backtest-stat-extra">平均${summary.blueAvgHits}中</span></span></div><div class="backtest-stat"><strong>平均每期/高光期</strong><br>${summary.avgTotalHits} / ${summary.strongIssues}</div></div>`;
  const renderBacktestIssue = (item, open = false) => {
    const hasPrediction = item.prediction?.red?.length || item.prediction?.blue?.length;
    const summaryText = item.isOpened ? `${item.issue}期：${item.totalHits}中（红${item.redHits.length} 蓝${item.blueHits.length}）` : `${item.issue}期：待开奖`;
    const actualLine = item.isOpened ? formatPick({ red: item.actual.red, blue: [item.actual.blue] }) : '<span class="prediction-empty">待开奖</span>';
    const predictionLine = hasPrediction ? formatPick(item.prediction) : '<span class="prediction-empty">空</span>';
    const analysisText = item.isOpened ? `<span>${item.totalHits}中</span>` : '<span class="prediction-empty">待开奖后分析</span>';
    return `<details class="backtest-issue" ${open ? "open" : ""}><summary>${summaryText}</summary><div class="backtest-issue-body"><div class="backtest-result-line"><span>开奖号</span>${actualLine}</div><div class="backtest-result-line"><span>预测号</span>${predictionLine}${analysisText}</div></div></details>`;
  };
  return Object.freeze({ renderBacktestIssue, renderBacktestStats });
};
