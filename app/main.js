import { AI_STRATEGY_ID, DEFAULT_STRATEGIES, PICK_LINE_LABELS, RETIRED_DEFAULT_STRATEGY_IDS } from "./config/strategies.js";
import { API_ENDPOINTS, APP_VERSION, HISTORY_LIMITS, MARKER_STYLE, OLD_STORAGE_KEYS, RECORD_FILE_NAME } from "./config/app-config.js";
import { getAppDom } from "./core/dom.js";
import { buildChartTable } from "./domain/chart/chart-table.js";
import { evaluateBacktestPick, normalizeBacktestRecord, summarizeBacktestResults } from "./domain/backtest/evaluator.js";
import { createRecordRepository } from "./services/record-repository.js";
import { createAnnotationRenderer, rectFromPoints, snapLinePoint } from "./features/annotation/annotation-renderer.js";
import { createAnnotationModel } from "./features/annotation/annotation-model.js";
import { applyStrategyScores, buildNumberStats, topNumbersByScore } from "./domain/strategy/strategy-engine.js";
import { historyKey, trimHistory as trimHistoryEntries } from "./services/history-service.js";
import { hasRecordContent as recordHasContent } from "./state/record-schema.js";
import { completePick, getNextPredictionIssue, parsePredictionEditorText, pickInputValue } from "./domain/prediction/picks.js";
import { createBacktestView } from "./features/backtest/backtest-view.js";

(() => {
  const core = window.SSQCore;
  const geometry = window.SSQAnnotationGeometry;
  if (!core || !geometry) throw new Error("核心模块加载失败，请通过本地启动器重新打开应用。");
  const { STORAGE_KEY, STORAGE_SCHEMA_VERSION, compactIssueKey, htmlEscape, normalizePicks: normalizeSharedPicks, parsePickInput, uniqueSorted } = core;
  const { boundsFromHandle, normalizeBounds, pointInBounds, pointsBounds, scalePoint } = geometry;
  const REFRESH_ENDPOINT = API_ENDPOINTS.refresh;
  const RECORD_ENDPOINT = API_ENDPOINTS.records;
  const OLD_KEYS = OLD_STORAGE_KEYS;
  const HISTORY_LIMIT = HISTORY_LIMITS.entries;
  const HISTORY_MAX_BYTES = HISTORY_LIMITS.bytes;
  const recordRepository = createRecordRepository({ storage: localStorage, storageKey: STORAGE_KEY, oldKeys: OLD_KEYS, endpoint: RECORD_ENDPOINT });
  const {
    workspace, chartSurface, chartHost, predictionPanel, chartMeta, canvas, ctx,
    swatchButtons, versionBadge, statusText, toggleButton, toggleText, exportButton,
    refreshChartButton, latestIssue, latestBalls, refreshLatestButton, recordInput, toolButtons
  } = getAppDom();
  const { drawAction } = createAnnotationRenderer(ctx);
  const { actionBounds, cloneAction, moveAction, scaleAction, scaleTextAction, textBounds } = createAnnotationModel({ context: ctx, normalizeBounds, pointsBounds, scalePoint });
  toolButtons.forEach((button) => button.setAttribute("aria-label", button.title));
  swatchButtons.forEach((button) => button.setAttribute("aria-label", button.title));
  let actions = [];
  let picks = { 1: { red: [], blue: [] }, 2: { red: [], blue: [] }, 3: { red: [], blue: [] } };
  let predictionLines = { 1: { red: [], blue: [] }, 2: { red: [], blue: [] }, 3: { red: [], blue: [] } };
  let aiManualPick = { red: [], blue: [] };
  let predictionIssue = "";
  let savedBacktestPredictions = {};
  let backtestWindowSize = 20;
  let lastModelFilledLine = null;
  let currentTool = "hand";
  let isDrawing = false;
  let startPoint = null;
  let currentPath = null;
  let previewPoint = null;
  let resizeTimer = 0;
  let pickActionPositionTimer = 0;
  let saveTimer = 0;
  let saveInFlight = false;
  let savePending = false;
  let annotationsVisible = true;
  let loadedCoordinateSpace = "chartHost";
  let loadedChartIssues = null;
  let selectedIndex = -1;
  let editMode = null;
  let editStartPoint = null;
  let editOriginalAction = null;
  let editOriginalBounds = null;
  let editHasMoved = false;
  let editingTextIndex = -1;
  let activeTextBox = null;
  let redMiss = Array(34).fill(0);
  let blueMiss = Array(17).fill(0);
  let strokeColor = swatchButtons.find((button) => button.classList.contains("active"))?.dataset.color || MARKER_STYLE.defaultColor;
  const getStyle = () => ({ color: strokeColor, width: MARKER_STYLE.width });
  const setStatus = (text) => { statusText.textContent = text; clearTimeout(statusText._timer); statusText._timer = setTimeout(() => { statusText.textContent = "自动保存已开启"; }, 1800); };
  const ballHtml = (number, color) => `<span class="ball ${color}">${String(number).padStart(2, "0")}</span>`;

  let strategyLibrary = DEFAULT_STRATEGIES.map((strategy) => ({ ...strategy }));
  let selectedStrategyIds = [];
  let historyPast = [];
  let historyFuture = [];
  let historySnapshot = null;
  let restoringHistory = false;
  const normalizePicks = () => {
    picks = normalizeSharedPicks(picks);
  };
  const currentChartIssues = () => (window.SSQ_CHART_DATA?.rows || []).map((row) => String(row.issue));
  const applyLotteryData = (payload) => {
    const previousIssueLayout = captureIssueLayout();
    if (payload?.chart?.rows?.length) window.SSQ_CHART_DATA = payload.chart;
    if (payload?.latest) window.SSQ_LATEST = payload.latest;
    renderChart();
    syncAnnotationsToIssueLayout(previousIssueLayout);
    resizeCanvas();
    drawAll();
  };
  const refreshLotteryData = async () => {
    const isLocalServer = location.protocol.startsWith("http") && /^(127\.0\.0\.1|localhost)$/i.test(location.hostname);
    if (!isLocalServer) {
      setStatus("请先用对应系统的启动脚本打开后再刷新数据");
      alert("请先双击对应系统的启动入口打开本项目，再点刷新图表。Windows 使用“打开双色球分析.vbs”，macOS 使用“打开双色球分析.app”。");
      return false;
    }
    setStatus("正在刷新500彩票网数据...");
    const response = await fetch(`${REFRESH_ENDPOINT}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`刷新失败：HTTP ${response.status}`);
    const payload = await response.json();
    applyLotteryData(payload);
    setStatus(`已更新至 ${window.SSQ_LATEST?.issue || "最新"} 期`);
    return true;
  };
  const showLatest = () => {
    const latest = window.SSQ_LATEST || {};
    const rowLatest = window.SSQ_CHART_DATA?.rows?.at(-1);
    const issue = latest.issue || (rowLatest ? `20${rowLatest.issue}` : "暂无数据");
    const red = latest.red || rowLatest?.red || [];
    const blue = latest.blue || (rowLatest ? [rowLatest.blue] : []);
    latestIssue.textContent = `${issue}期`;
    latestBalls.innerHTML = red.map((n) => ballHtml(n, "red")).join("") + blue.map((n) => ballHtml(n, "blue")).join("");
  };
  const drawBlueTrendLines = () => {
    chartHost.querySelector(".trend-layer")?.remove();
    const hits = Array.from(chartHost.querySelectorAll(".trend-blue"));
    if (hits.length < 2) return;
    const hostRect = chartHost.getBoundingClientRect();
    const points = hits.map((hit) => {
      const rect = hit.getBoundingClientRect();
      return { x: rect.left - hostRect.left + rect.width / 2, y: rect.top - hostRect.top + rect.height / 2 };
    });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("trend-layer");
    svg.setAttribute("width", chartHost.scrollWidth);
    svg.setAttribute("height", chartHost.scrollHeight);
    svg.setAttribute("viewBox", `0 0 ${chartHost.scrollWidth} ${chartHost.scrollHeight}`);
    const ballRadius = 12;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", a.x + ux * ballRadius);
      line.setAttribute("y1", a.y + uy * ballRadius);
      line.setAttribute("x2", b.x - ux * ballRadius);
      line.setAttribute("y2", b.y - uy * ballRadius);
      svg.appendChild(line);
    }
    chartHost.appendChild(svg);
  };
  const captureIssueLayout = () => {
    const hostRect = chartHost.getBoundingClientRect();
    const rows = Array.from(chartHost.querySelectorAll(".chart-table tbody tr")).filter((row) => /^\d+$/.test(row.querySelector(".issue-col")?.textContent?.trim() || ""));
    const positions = new Map();
    let top = Infinity;
    let bottom = -Infinity;
    rows.forEach((row) => {
      const issue = row.querySelector(".issue-col").textContent.trim();
      const rect = row.getBoundingClientRect();
      const rowTop = rect.top - hostRect.top;
      const rowBottom = rect.bottom - hostRect.top;
      positions.set(issue, rowTop + rect.height / 2);
      top = Math.min(top, rowTop);
      bottom = Math.max(bottom, rowBottom);
    });
    return { positions, top, bottom };
  };
  const actionTouchesIssueArea = (action, layout) => {
    const bounds = actionBounds(action);
    if (!bounds || !Number.isFinite(layout.top) || !Number.isFinite(layout.bottom)) return false;
    return bounds.y <= layout.bottom + 2 && bounds.y + bounds.h >= layout.top - 2;
  };
  const syncAnnotationsToIssueLayout = (previousLayout) => {
    if (!previousLayout?.positions?.size || !actions.length) return;
    const nextLayout = captureIssueLayout();
    const deltas = [];
    previousLayout.positions.forEach((oldY, issue) => {
      if (nextLayout.positions.has(issue)) deltas.push(nextLayout.positions.get(issue) - oldY);
    });
    if (deltas.length < 3) return;
    deltas.sort((a, b) => a - b);
    const deltaY = deltas[Math.floor(deltas.length / 2)];
    if (Math.abs(deltaY) < 0.5) return;
    actions.forEach((action) => {
      if (actionTouchesIssueArea(action, previousLayout)) moveAction(action, 0, deltaY);
    });
    scheduleSave();
  };
  const layoutFromIssueList = (issues) => {
    const nextLayout = captureIssueLayout();
    if (!Array.isArray(issues) || !issues.length || !nextLayout.positions.size) return null;
    const rowHeight = (nextLayout.bottom - nextLayout.top) / nextLayout.positions.size;
    if (!Number.isFinite(rowHeight) || rowHeight <= 0) return null;
    const positions = new Map();
    issues.map(String).forEach((issue, index) => positions.set(issue, nextLayout.top + rowHeight * (index + 0.5)));
    return { positions, top: nextLayout.top, bottom: nextLayout.top + rowHeight * issues.length };
  };
  const syncLoadedAnnotationsToCurrentChart = () => {
    if (!loadedChartIssues?.length) return;
    syncAnnotationsToIssueLayout(layoutFromIssueList(loadedChartIssues));
    loadedChartIssues = currentChartIssues();
  };
  const renderChart = () => {
    const rows = window.SSQ_CHART_DATA?.rows || [];
    if (!rows.length) { chartHost.innerHTML = '<div style="padding:24px;background:#fff;border:1px solid #d7dce3">未找到本地图表数据，请运行对应系统的启动脚本刷新。</div>'; return; }
    chartMeta.textContent = `最近 ${rows.length} 期，生成时间：${window.SSQ_CHART_DATA.generatedAt || "未知"}`;
    const chartTable = buildChartTable(rows, picks);
    redMiss = chartTable.redMiss;
    blueMiss = chartTable.blueMiss;
    chartHost.innerHTML = chartTable.html;
    renderPickActionButtons();
    showLatest();
    renderPredictionPanel();
    setTimeout(() => { resizeCanvas(); drawBlueTrendLines(); }, 60);
  };
  const pickRowByLine = (line) => chartHost.querySelector(`.pick-row [data-pick-line="${line}"]`)?.closest("tr");
  const positionPickActionButton = (button, line, side) => {
    const row = pickRowByLine(line);
    const table = chartHost.querySelector(".chart-table");
    if (!row || !table) return;
    const top = row.offsetTop + Math.max(0, (row.offsetHeight - button.offsetHeight) / 2);
    const workspaceRect = chartSurface.parentElement.getBoundingClientRect();
    const hostRect = chartHost.getBoundingClientRect();
    const visibleLeft = workspaceRect.left - hostRect.left + 8;
    const visibleRight = workspaceRect.right - hostRect.left - button.offsetWidth - 8;
    const clampToVisible = (left) => Math.max(visibleLeft, Math.min(left, visibleRight));
    button.style.top = `${top}px`;
    if (side === "left") button.style.left = `${Math.max(table.offsetLeft - button.offsetWidth - 6, visibleLeft)}px`;
    else button.style.left = `${clampToVisible(table.offsetLeft + table.offsetWidth + 6)}px`;
  };
  const positionPickActionButtons = () => {
    const swapButton = chartHost.querySelector('[data-pick-swap]');
    if (swapButton) positionPickActionButton(swapButton, 1, "left");
    chartHost.querySelectorAll('[data-pick-clear]').forEach((button) => {
      positionPickActionButton(button, Number(button.dataset.pickClear), "right");
    });
  };
  const schedulePickActionButtonPosition = () => { cancelAnimationFrame(pickActionPositionTimer); pickActionPositionTimer = requestAnimationFrame(positionPickActionButtons); };
  const renderPickActionButtons = () => {
    chartHost.querySelectorAll(".pick-action-button").forEach((button) => button.remove());
    if (!pickRowByLine(1)) return;
    const swapButton = document.createElement("button");
    swapButton.className = "pick-action-button";
    swapButton.type = "button";
    swapButton.dataset.pickSwap = "1-2";
    swapButton.textContent = "\u8c03\u6362";
    const clearButtons = [1, 2, 3].map((line) => {
      const button = document.createElement("button");
      button.className = "pick-action-button";
      button.type = "button";
      button.dataset.pickClear = String(line);
      button.textContent = "\u6e05\u9664";
      return button;
    });
    chartHost.append(swapButton, ...clearButtons);
    positionPickActionButtons();
  };
  const parsePredictionInput = parsePickInput;
  const normalizePredictionLines = () => {
    for (let line = 1; line <= 3; line += 1) {
      predictionLines[line] = predictionLines[line] || { red: [], blue: [] };
      predictionLines[line].red = uniqueSorted(predictionLines[line].red, 33).slice(0, 6);
      predictionLines[line].blue = uniqueSorted(predictionLines[line].blue, 16).slice(0, 1);
    }
  };
  const nextPredictionIssue = () => getNextPredictionIssue(window.SSQ_LATEST?.issue, window.SSQ_CHART_DATA?.rows?.at(-1)?.issue);
  const formatPick = (pick) => {
    const red = uniqueSorted(pick?.red || [], 33);
    const blue = uniqueSorted(pick?.blue || [], 16);
    if (!red.length && !blue.length) return '<span class="prediction-empty">未输入</span>';
    return `<span class="prediction-balls">${red.map((n) => ballHtml(n, "red")).join("")}${blue.map((n) => ballHtml(n, "blue")).join("")}</span>`;
  };
  const { renderBacktestIssue, renderBacktestStats } = createBacktestView({ formatPick });
  const renderPickEditorContent = (pick, pending = "") => {
    const red = uniqueSorted(pick?.red || [], 33);
    const blue = uniqueSorted(pick?.blue || [], 16);
    const balls = red.map((n) => ballHtml(n, "red")).join("") + blue.map((n) => ballHtml(n, "blue")).join("");
    const tail = pending ? `<span class="prediction-pending">${htmlEscape(pending)}</span>` : "";
    if (!balls && !tail) return '<span class="prediction-empty">输入号码</span>';
    return balls + tail;
  };
  const placeCaretAtEnd = (element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const syncPredictionLineDom = (line) => {
    const editor = predictionPanel?.querySelector(`[data-prediction-line="${line}"]`);
    if (!editor) return;
    editor.classList.remove("editing");
    editor.innerHTML = renderPickEditorContent(predictionLines[line]);
  };
  const isAiStrategy = (strategy) => strategy?.id === AI_STRATEGY_ID || strategy?.mode === "ai";
  const selectedAiStrategy = () => strategyLibrary.find((strategy) => selectedStrategyIds.includes(strategy.id) && isAiStrategy(strategy));
  const displayStrategyName = (strategy) => isAiStrategy(strategy) ? "AI" : (strategy.name || "\u65b0\u7b56\u7565");
  const isLegacyAiDuplicate = (strategy) => !isAiStrategy(strategy) && (/^AI$/i.test(String(strategy?.name || "").trim()) || String(strategy?.name || "").trim() === "\u65b0\u7b56\u7565");
  const normalizeAiManualPick = () => {
    aiManualPick = { red: uniqueSorted(aiManualPick?.red || [], 33).slice(0, 6), blue: uniqueSorted(aiManualPick?.blue || [], 16).slice(0, 1) };
  };
  const buildAiPick = () => {
    normalizeAiManualPick();
    return { red: [...aiManualPick.red], blue: [...aiManualPick.blue], source: "ai", redStats: [], blueStats: [] };
  };
  const aiInputValue = () => pickInputValue(aiManualPick);
  const focusAiInlineInput = () => setTimeout(() => { const input = document.querySelector("[data-ai-inline-input]"); if (input) { input.focus(); input.select(); } }, 0);
  const updateAiInlineInput = (input, silent = false, refreshModel = true) => {
    aiManualPick = parsePredictionInput(input.value);
    normalizeAiManualPick();
    scheduleSave();
    if (refreshModel) refreshPredictionModel();
    if (!silent) setStatus("AI\u53f7\u7801\u5df2\u66f4\u65b0");
  };
  const buildModelPick = () => {
    if (selectedAiStrategy()) return buildAiPick();
    const rows = window.SSQ_CHART_DATA?.rows || [];
    if (!selectedStrategyIds.length || rows.length < 5) return null;
    const { redStats, blueStats } = buildNumberStats(rows);
    applyStrategyScores({ historyRows: rows, redStats, blueStats, strategyIds: selectedStrategyIds, strategyLibrary, predictionLines, isAiStrategy });
    const red = topNumbersByScore(redStats.slice(1), 6);
    const blue = topNumbersByScore(blueStats.slice(1), 1);
    return { red, blue, redStats, blueStats };
  };
  const scoreSummary = (stats, selected) => selected.map((number) => {
    const item = stats?.[number];
    if (!item) return `${String(number).padStart(2, "0")}\uff1aAI\u8f93\u5165`;
    const reasons = item?.reasons?.slice(0, 3).join("\u3001") || "\u57fa\u7840\u5206";
    return `${String(number).padStart(2, "0")}\uff1a${item.score.toFixed(1)}\u5206\uff08${reasons}\uff09`;
  });
  const fillModelPredictionToPickLine = () => {
    const modelPick = buildModelPick();
    if (!modelPick) { setStatus("暂无可填入的模型预测"); return; }
    picks[2] = { red: [...modelPick.red], blue: [...modelPick.blue] };
    syncPickLineDom(2);
    scheduleSave();
    setStatus("模型预测已填入图表预选2");
  };
  const clearLastModelPick = () => {
    picks[2] = { red: [], blue: [] };
    syncPickLineDom(2);
    scheduleSave();
    setStatus("图表预选2已清除");
  };
  const updatePredictionLineFromInput = (input, silent = false) => {
    const line = Number(input.dataset.predictionLine);
    if (!predictionLines[line]) return null;
    predictionLines[line] = parsePredictionInput(input.value ?? input.textContent);
    scheduleSave();
    if (!silent) setStatus(`${PICK_LINE_LABELS[line]}已更新`);
    return predictionLines[line];
  };
  const startPredictionLineEdit = (editor) => {
    const line = Number(editor.dataset.predictionLine);
    editor.classList.add("editing");
    editor.textContent = pickInputValue(predictionLines[line]);
    placeCaretAtEnd(editor);
  };
  const renderPredictionLineAsBalls = (editor) => {
    updatePredictionLineFromInput(editor, true);
    syncPredictionLineDom(Number(editor.dataset.predictionLine));
  };
  const insertPlainTextAtCaret = (text) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    selection.deleteFromDocument();
    selection.getRangeAt(0).insertNode(document.createTextNode(text));
    selection.collapseToEnd();
  };
  const saveModelPredictionForBacktest = () => {
    const modelPick = buildModelPick();
    const issue = document.getElementById("predictionIssue")?.value?.trim() || predictionIssue || nextPredictionIssue();
    if (!modelPick || !issue) { setStatus("暂无可保存的模型预测"); return; }
    predictionIssue = issue;
    savedBacktestPredictions[issue] = { red: [...modelPick.red], blue: [...modelPick.blue], source: "本期预测模型", savedAt: new Date().toISOString() };
    renderPredictionPanel();
    scheduleSave();
    setStatus(`${issue}期模型预测已保存到回测区`);
  };
  const renderPredictionModel = () => {
    const activeNames = strategyLibrary.filter((strategy) => selectedStrategyIds.includes(strategy.id)).map(displayStrategyName).join("\u3001") || "\u672a\u9009\u62e9\u7b56\u7565";
    if (!selectedStrategyIds.length) return '<div class="model-result"><div class="prediction-empty">\u5f53\u524d\u4f7f\u7528\uff1a' + activeNames + '</div><div class="model-pick-line"><span>\u6a21\u578b\u9884\u6d4b</span><span class="prediction-empty">\u672a\u9009\u62e9\u7b56\u7565</span></div></div>';
    const modelPick = buildModelPick();
    if (!modelPick) return '<div class="prediction-empty">\u672c\u5730\u5f00\u5956\u6570\u636e\u4e0d\u8db3\uff0c\u6682\u65f6\u65e0\u6cd5\u751f\u6210\u672c\u671f\u9884\u6d4b\u6a21\u578b\u3002</div>';
    const scoreBlock = selectedAiStrategy() ? "" : '<div class="model-score-list"><div><strong>\u7ea2\u7403\u4f9d\u636e</strong><br>' + scoreSummary(modelPick.redStats, modelPick.red).join("<br>") + '</div><div><strong>\u84dd\u7403\u4f9d\u636e</strong><br>' + scoreSummary(modelPick.blueStats, modelPick.blue).join("<br>") + '</div></div>';
    return '<div class="model-result"><div class="prediction-empty">\u5f53\u524d\u4f7f\u7528\uff1a' + activeNames + '</div><div class="model-pick-line"><span>\u6a21\u578b\u9884\u6d4b</span>' + formatPick(modelPick) + '<div class="model-pick-actions"><div class="model-pick-action-row"><button class="prediction-button secondary" type="button" data-action="fill-model-pick">\u586b\u5165\u9884\u9009</button><button class="prediction-button secondary" type="button" data-action="clear-prediction">\u6e05\u9664</button></div><div class="model-pick-action-row"><button class="prediction-button" type="button" data-action="save-model-backtest">\u4fdd\u5b58</button></div></div></div>' + scoreBlock + '</div>';
  };
  const renderManualPredictionPanel = () => `<section class="prediction-section"><h2>\u9884\u6d4b\u533a</h2><div class="prediction-controls"><label>\u9884\u6d4b\u671f\u53f7 <input class="prediction-input" id="predictionIssue" value="${htmlEscape(predictionIssue)}"></label></div><div class="prediction-line-list">${[1,2,3].map((line) => `<div class="prediction-line"><strong>${PICK_LINE_LABELS[line]}</strong><div class="prediction-number-input" data-prediction-line="${line}" contenteditable="plaintext-only" inputmode="numeric" spellcheck="false" role="textbox" aria-label="${PICK_LINE_LABELS[line]}\u53f7\u7801">${renderPickEditorContent(predictionLines[line])}</div></div>`).join("")}</div><h3>\u672c\u671f\u9884\u6d4b\u6a21\u578b</h3><div data-model-host>${renderPredictionModel()}</div></section>`;
  const refreshPredictionModel = () => { const host = predictionPanel.querySelector("[data-model-host]"); if (host) host.innerHTML = renderPredictionModel(); };
  const closeStrategyDialog = () => document.querySelector(".strategy-dialog-backdrop")?.remove();
  const saveStrategy = ({ id, name, explain, example }) => {
    const payload = { name: name.trim() || "\u65b0\u7b56\u7565", explain: explain.trim(), example: example.trim() };
    if (id) {
      const index = strategyLibrary.findIndex((strategy) => strategy.id === id);
      if (index >= 0) strategyLibrary[index] = { ...strategyLibrary[index], ...payload };
      setStatus("已修改策略");
    } else {
      const nextId = `custom-${Date.now().toString(36)}`;
      strategyLibrary.push({ id: nextId, weight: 1, ...payload });
      selectedStrategyIds.push(nextId);
      setStatus("已新增策略");
    }
    renderPredictionPanel();
    scheduleSave();
  };
  const openStrategyDialog = (id = null) => {
    closeStrategyDialog();
    const strategy = id ? strategyLibrary.find((item) => item.id === id) : null;
    const backdrop = document.createElement("div");
    backdrop.className = "strategy-dialog-backdrop";
    backdrop.innerHTML = `<div class="strategy-dialog" role="dialog" aria-modal="true" aria-labelledby="strategyDialogTitle"><h3 id="strategyDialogTitle">${strategy ? "修改策略" : "新策略"}</h3><div class="strategy-dialog-fields"><label>策略名称<input data-strategy-dialog-field="name" placeholder="例如：热号延续" value="${htmlEscape(strategy?.name || "")}"></label><label>解释<textarea data-strategy-dialog-field="explain" placeholder="写清楚这个策略为什么会影响选号">${htmlEscape(strategy?.explain || "")}</textarea></label><label>示例<textarea data-strategy-dialog-field="example" placeholder="举一个使用这个策略的号码示例">${htmlEscape(strategy?.example || "")}</textarea></label></div><div class="strategy-dialog-actions"><button class="prediction-button secondary" type="button" data-strategy-dialog="cancel">取消</button><button class="prediction-button" type="button" data-strategy-dialog="save">保存</button></div></div>`;
    document.body.appendChild(backdrop);
    const nameInput = backdrop.querySelector('[data-strategy-dialog-field="name"]');
    const explainInput = backdrop.querySelector('[data-strategy-dialog-field="explain"]');
    const exampleInput = backdrop.querySelector('[data-strategy-dialog-field="example"]');
    const saveDialog = () => {
      saveStrategy({ id, name: nameInput.value, explain: explainInput.value, example: exampleInput.value });
      closeStrategyDialog();
    };
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop || event.target.closest('[data-strategy-dialog="cancel"]')) closeStrategyDialog(); if (event.target.closest('[data-strategy-dialog="save"]')) saveDialog(); });
    backdrop.addEventListener("keydown", (event) => { if (event.key === "Escape") closeStrategyDialog(); if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) saveDialog(); });
    nameInput.focus();
  };
  const removeStrategy = (id) => {
    if (DEFAULT_STRATEGIES.some((strategy) => strategy.id === id)) return setStatus("默认策略不能删除");
    strategyLibrary = strategyLibrary.filter((strategy) => strategy.id !== id);
    selectedStrategyIds = selectedStrategyIds.filter((item) => item !== id);
    renderPredictionPanel();
    scheduleSave();
    setStatus("已删除策略");
  };
  const currentSelectedStrategy = () => [...selectedStrategyIds].reverse().map((id) => strategyLibrary.find((strategy) => strategy.id === id)).find(Boolean) || null;
  const editSelectedStrategy = () => {
    const strategy = currentSelectedStrategy();
    if (!strategy) return setStatus("请先选择策略");
    openStrategyDialog(strategy.id);
  };
  const removeSelectedStrategy = () => {
    const strategy = currentSelectedStrategy();
    if (!strategy) return setStatus("请先选择策略");
    removeStrategy(strategy.id);
  };
  const normalizeSelectedStrategyIds = () => {
    const selected = new Set(selectedStrategyIds);
    selectedStrategyIds = strategyLibrary.map((strategy) => strategy.id).filter((id) => selected.has(id));
    const ai = strategyLibrary.find((strategy) => selectedStrategyIds.includes(strategy.id) && isAiStrategy(strategy));
    if (ai) selectedStrategyIds = [ai.id];
  };
  const toggleStrategySelection = (id) => {
    if (!id) return;
    const strategy = strategyLibrary.find((item) => item.id === id);
    if (!strategy) return;
    const selected = new Set(selectedStrategyIds);
    if (isAiStrategy(strategy)) {
      if (selected.has(id)) {
        selectedStrategyIds = [];
        renderPredictionPanel();
        scheduleSave();
        setStatus("\u5df2\u53d6\u6d88AI\u7b56\u7565");
        return;
      }
      selectedStrategyIds = [id];
      renderPredictionPanel();
      scheduleSave();
      focusAiInlineInput();
      return;
    }
    strategyLibrary.filter(isAiStrategy).forEach((item) => selected.delete(item.id));
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    selectedStrategyIds = strategyLibrary.filter((item) => !isAiStrategy(item) && selected.has(item.id)).map((item) => item.id);
    renderPredictionPanel();
    scheduleSave();
    setStatus("\u9884\u6d4b\u7b56\u7565\u5df2\u66f4\u65b0");
  };
  const selectAllStrategies = () => {
    selectedStrategyIds = strategyLibrary.filter((strategy) => !isAiStrategy(strategy)).map((strategy) => strategy.id);
    normalizeSelectedStrategyIds();
    renderPredictionPanel();
    scheduleSave();
    setStatus("已全选策略");
  };
  const clearSelectedStrategies = () => {
    selectedStrategyIds = [];
    renderPredictionPanel();
    scheduleSave();
    setStatus("已清除策略选择");
  };
  const renderStrategyLibraryPanel = () => `<section class="prediction-section"><h2>\u7b56\u7565\u5e93</h2><div class="strategy-actions"><div class="strategy-action-group"><button class="prediction-button secondary" type="button" data-action="select-all-strategies">\u5168\u9009</button><button class="prediction-button secondary" type="button" data-action="clear-selected-strategies">\u6e05\u9664</button></div></div><div class="strategy-list">${strategyLibrary.map((strategy) => { const selected = selectedStrategyIds.includes(strategy.id); const detail = `${strategy.explain || "\u6682\u65e0\u89e3\u91ca"}${strategy.example ? `\n${strategy.example}` : ""}`; const button = `<button class="strategy-card ${selected ? "selected" : ""}" type="button" data-strategy-id="${strategy.id}" title="${htmlEscape(detail)}">${htmlEscape(displayStrategyName(strategy))}</button>`; const aiInput = selected && isAiStrategy(strategy) ? `<input class="strategy-ai-input strategy-ai-inline" data-ai-inline-input placeholder="01 06 12 18 26 31 08" value="${htmlEscape(aiInputValue())}">` : ""; return button + aiInput; }).join("")}</div></section>`;
  const backtestPredictionMap = () => {
    const merged = { ...(window.SSQ_BACKTEST_PREDICTIONS || {}), ...savedBacktestPredictions };
    return Object.fromEntries(Object.entries(merged).map(([issue, record]) => [String(issue), normalizeBacktestRecord(record)]).filter(([, record]) => record.red.length || record.blue.length));
  };
  const isSameIssue = (a, b) => compactIssueKey(a) && compactIssueKey(a) === compactIssueKey(b);
  const isSamePick = (a, b) => {
    const redA = uniqueSorted(a?.red || [], 33).join(",");
    const redB = uniqueSorted(b?.red || [], 33).join(",");
    const blueA = uniqueSorted(a?.blue || [], 16).join(",");
    const blueB = uniqueSorted(b?.blue || [], 16).join(",");
    return redA === redB && blueA === blueB && Boolean(redA || blueA);
  };
  const currentModelBacktestState = () => {
    const issue = document.getElementById("predictionIssue")?.value?.trim() || predictionIssue || nextPredictionIssue();
    if (!issue) return null;
    const savedEntry = Object.keys(savedBacktestPredictions || {}).find((key) => isSameIssue(key, issue));
    const savedPick = savedEntry ? savedBacktestPredictions[savedEntry] : null;
    const modelPick = buildModelPick();
    const showSavedPick = savedEntry && modelPick && isSamePick(savedPick, modelPick);
    return { issue: savedEntry || issue, isSaved: Boolean(savedEntry), pick: showSavedPick ? { red: [...modelPick.red], blue: [...modelPick.blue] } : { red: [], blue: [] } };
  };
  const buildBacktestResults = () => {
    const predictionMap = backtestPredictionMap();
    const currentModelState = currentModelBacktestState();
    const rowsByIssue = new Map();
    (window.SSQ_CHART_DATA?.rows || []).forEach((row) => {
      rowsByIssue.set(String(row.issue), row);
      rowsByIssue.set(compactIssueKey(row.issue), row);
    });
    if (currentModelState && !rowsByIssue.has(compactIssueKey(currentModelState.issue)) && !Object.keys(predictionMap).some((issue) => isSameIssue(issue, currentModelState.issue))) {
      predictionMap[currentModelState.issue] = { red: [], blue: [], source: "本期预测模型", savedAt: "" };
    }
    return Object.entries(predictionMap).map(([issue, prediction]) => {
      const row = rowsByIssue.get(String(issue)) || rowsByIssue.get(compactIssueKey(issue));
      const isCurrentPendingIssue = currentModelState && isSameIssue(issue, currentModelState.issue) && !row;
      const displayedPrediction = isCurrentPendingIssue ? currentModelState.pick : prediction;
      if (!row) return { issue, actual: null, prediction: displayedPrediction, source: prediction.source, isOpened: false, redHits: [], blueHits: [], totalHits: 0 };
      const actual = { red: row.red.map(Number), blue: Number(row.blue) };
      return { issue: row.issue, actual, prediction, source: prediction.source, isOpened: true, ...evaluateBacktestPick(prediction, row) };
    }).sort((a, b) => Number(compactIssueKey(a.issue)) - Number(compactIssueKey(b.issue)));
  };
  const renderBacktestPanel = () => {
    const allResults = buildBacktestResults();
    const openedResults = allResults.filter((item) => item.isOpened);
    const pendingResults = allResults.filter((item) => !item.isOpened);
    const controls = `<div class="prediction-controls"><span>回测期数</span><div class="backtest-window-buttons">${[5, 10, 15, 20].map((count) => `<button class="backtest-window-button ${backtestWindowSize === count ? "selected" : ""}" type="button" data-backtest-window="${count}">${count}期</button>`).join("")}</div></div>`;
    if (!allResults.length) return `<section class="prediction-section"><h2>回测区</h2>${controls}<div class="prediction-empty">请先保存本期模型预测，或导入历史预测记录。</div></section>`;
    const selectedOpenedResults = openedResults.slice(-Math.min(backtestWindowSize, openedResults.length));
    const selectedResults = [...selectedOpenedResults, ...pendingResults];
    const selectedSummary = summarizeBacktestResults(selectedOpenedResults);
    const allSummary = summarizeBacktestResults(openedResults);
    const selectedTitleCount = Math.min(backtestWindowSize, openedResults.length);
    return `<section class="prediction-section"><h2>回测区</h2>${controls}<div class="backtest-panel"><details class="backtest-details" open><summary><span>最近${selectedTitleCount}期回测</span><span>平均${selectedSummary.avgTotalHits}中</span></summary><div class="backtest-body">${renderBacktestStats(selectedSummary)}<div class="backtest-list">${selectedResults.map((item, index) => renderBacktestIssue(item, index === selectedResults.length - 1)).join("")}</div></div></details><details class="backtest-details"><summary><span>全部已保存预测</span><span>${allResults.length}期</span></summary><div class="backtest-body">${renderBacktestStats(allSummary)}<div class="backtest-list">${allResults.map((item) => renderBacktestIssue(item)).join("")}</div></div></details></div></section>`;
  };
  const renderPanelError = (title, error) => `<section class="prediction-section"><h2>${title}</h2><div class="prediction-empty">${htmlEscape(error?.message || error)}</div></section>`;
  const renderPredictionPanel = () => {
    if (!predictionPanel) return;
    normalizePredictionLines();
    if (!predictionIssue) predictionIssue = nextPredictionIssue();
    let manualPanel = "";
    let strategyPanel = "";
    let backtestPanel = "";
    try { manualPanel = renderManualPredictionPanel(); } catch (error) { console.error(error); manualPanel = renderPanelError("\u9884\u6d4b\u533a", error); }
    try { strategyPanel = renderStrategyLibraryPanel(); } catch (error) { console.error(error); strategyPanel = renderPanelError("\u7b56\u7565\u5e93", error); }
    try { backtestPanel = renderBacktestPanel(); } catch (error) { console.error(error); backtestPanel = renderPanelError("\u56de\u6d4b\u533a", error); }
    predictionPanel.innerHTML = `<div class="prediction-grid"><div class="feature-top-row">${manualPanel}${strategyPanel}</div>${backtestPanel}</div>`;
  };
  const chartOffset = () => { const surfaceRect = chartSurface.getBoundingClientRect(); const hostRect = chartHost.getBoundingClientRect(); return { x: hostRect.left - surfaceRect.left, y: hostRect.top - surfaceRect.top }; };
  const getPoint = (event) => { const rect = chartHost.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const toSurfacePoint = (point) => { const offset = chartOffset(); return { x: point.x + offset.x, y: point.y + offset.y }; };
  const resizeCanvas = () => {
    const offset = chartOffset();
    const rect = chartHost.getBoundingClientRect();
    const width = Math.max(chartHost.scrollWidth, rect.width);
    const height = Math.max(chartHost.scrollHeight, rect.height);
    const ratio = window.devicePixelRatio || 1;
    canvas.style.left = `${offset.x}px`;
    canvas.style.top = `${offset.y}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawAll();
    positionPickActionButtons();
  };
  const scheduleResize = () => { cancelAnimationFrame(resizeTimer); resizeTimer = requestAnimationFrame(() => { resizeCanvas(); drawBlueTrendLines(); positionPickActionButtons(); }); };
  const hitActionIndex = (point) => {
    for (let index = actions.length - 1; index >= 0; index -= 1) {
      const bounds = actionBounds(actions[index]);
      if (bounds && pointInBounds(point, bounds, actions[index].type === "text" ? 3 : 8)) return index;
    }
    return -1;
  };
  const hitTextIndex = (point) => {
    for (let index = actions.length - 1; index >= 0; index -= 1) {
      if (actions[index].type === "text" && pointInBounds(point, actionBounds(actions[index]), 5)) return index;
    }
    return -1;
  };
  const selectionHandle = (point, bounds) => {
    const size = 4;
    const handles = {
      nw: { x: bounds.x, y: bounds.y },
      ne: { x: bounds.x + bounds.w, y: bounds.y },
      sw: { x: bounds.x, y: bounds.y + bounds.h },
      se: { x: bounds.x + bounds.w, y: bounds.y + bounds.h }
    };
    for (const [name, handle] of Object.entries(handles)) {
      if (Math.abs(point.x - handle.x) <= size && Math.abs(point.y - handle.y) <= size) return name;
    }
    return null;
  };
  const updateSelectionCursor = (point) => {
    if (currentTool !== "hand" || selectedIndex < 0 || editMode) return;
    const bounds = actionBounds(actions[selectedIndex]);
    const handle = bounds && selectionHandle(point, bounds);
    if (handle === "nw" || handle === "se") { canvas.style.cursor = "nwse-resize"; return; }
    if (handle === "ne" || handle === "sw") { canvas.style.cursor = "nesw-resize"; return; }
    canvas.style.cursor = bounds && pointInBounds(point, bounds, 0) ? "move" : "default";
  };
  const drawSelection = () => {
    const action = actions[selectedIndex];
    const bounds = actionBounds(action);
    if (!bounds) return;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = "#155eef";
    ctx.strokeRect(bounds.x, bounds.y, Math.max(1, bounds.w), Math.max(1, bounds.h));
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#155eef";
    [[bounds.x, bounds.y], [bounds.x + bounds.w, bounds.y], [bounds.x, bounds.y + bounds.h], [bounds.x + bounds.w, bounds.y + bounds.h]].forEach(([x, y]) => {
      ctx.save(); ctx.shadowColor = "rgba(21,94,239,.2)"; ctx.shadowBlur = 2; ctx.beginPath(); ctx.rect(x - 3, y - 3, 6, 6); ctx.fill(); ctx.stroke(); ctx.restore();
    });
    ctx.restore();
  };
  const drawingPoint = (point, event) => (event.shiftKey && (currentTool === "line" || currentTool === "arrow") && startPoint ? snapLinePoint(startPoint, point) : point);
  const drawPreview = () => { if (!isDrawing || !startPoint || !previewPoint || currentTool === "pen" || currentTool === "text") return; drawAction({ type: currentTool, start: startPoint, end: previewPoint, ...getStyle() }); };
  const drawAll = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    actions.forEach((action, index) => { if (index !== editingTextIndex) drawAction(action); });
    if (currentPath) drawAction(currentPath);
    drawPreview();
    drawSelection();
  };
  const buildRecordPayload = () => ({
    appVersion: APP_VERSION,
    version: STORAGE_SCHEMA_VERSION,
    coordinateSpace: "chartHost",
    savedAt: new Date().toISOString(),
    chartIssues: currentChartIssues(),
    actions,
    picks,
    predictionLines,
    aiManualPick,
    strategyLibrary,
    selectedStrategyIds,
    predictionIssue,
    savedBacktestPredictions,
    backtestWindowSize
  });
  const buildHistorySnapshot = () => ({
    actions,
    picks,
    predictionLines,
    aiManualPick,
    strategyLibrary,
    selectedStrategyIds,
    predictionIssue,
    savedBacktestPredictions,
    backtestWindowSize
  });
  const trimHistory = (items) => trimHistoryEntries(items, { entries: HISTORY_LIMIT, bytes: HISTORY_MAX_BYTES });
  const save = async () => {
    if (saveInFlight) { savePending = true; return; }
    saveInFlight = true;
    try {
      let finalPortableSaved = true;
      do {
        savePending = false;
        const payload = buildRecordPayload();
        const result = await recordRepository.save(payload);
        finalPortableSaved = result.portableSaved;
      } while (savePending);
      setStatus(recordRepository.isLocalServer && !finalPortableSaved ? "已保存到浏览器，移动硬盘记录写入失败" : "已自动保存");
    } finally {
      saveInFlight = false;
    }
  };
  const scheduleSave = () => {
    const nextSnapshot = buildHistorySnapshot();
    const nextKey = historyKey(nextSnapshot);
    if (!historySnapshot) historySnapshot = nextKey;
    else if (!restoringHistory && nextKey !== historySnapshot) {
      historyPast.push(historySnapshot);
      trimHistory(historyPast);
      historyFuture = [];
      historySnapshot = nextKey;
    } else if (restoringHistory) historySnapshot = nextKey;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  };
  const applyRecordPayload = (payload) => {
    if (Array.isArray(payload.actions)) actions = payload.actions;
    if (payload.picks) picks = { ...picks, ...payload.picks };
    normalizePicks();
    if (payload.predictionLines) predictionLines = { ...predictionLines, ...payload.predictionLines };
    normalizePredictionLines();
    if (payload.aiManualPick) { aiManualPick = { ...aiManualPick, ...payload.aiManualPick }; normalizeAiManualPick(); }
    if (Array.isArray(payload.strategyLibrary)) {
      const savedCustom = payload.strategyLibrary.filter((strategy) => !DEFAULT_STRATEGIES.some((item) => item.id === strategy.id) && !RETIRED_DEFAULT_STRATEGY_IDS.includes(strategy.id) && !isLegacyAiDuplicate(strategy));
      strategyLibrary = [...DEFAULT_STRATEGIES.map((strategy) => ({ ...strategy })), ...savedCustom];
    }
    if (Array.isArray(payload.selectedStrategyIds)) {
      const selectedFromPayload = new Set(payload.selectedStrategyIds);
      if (payload.strategyLibrary?.some((strategy) => selectedFromPayload.has(strategy.id) && isLegacyAiDuplicate(strategy))) selectedFromPayload.add(AI_STRATEGY_ID);
      selectedStrategyIds = [...selectedFromPayload].filter((id) => strategyLibrary.some((strategy) => strategy.id === id));
      if (!selectedStrategyIds.length && payload.selectedStrategyIds.some((id) => RETIRED_DEFAULT_STRATEGY_IDS.includes(id))) selectedStrategyIds = strategyLibrary.filter((strategy) => !isAiStrategy(strategy)).map((strategy) => strategy.id);
      normalizeSelectedStrategyIds();
    }
    predictionIssue = typeof payload.predictionIssue === "string" ? payload.predictionIssue : "";
    savedBacktestPredictions = payload.savedBacktestPredictions && typeof payload.savedBacktestPredictions === "object" ? payload.savedBacktestPredictions : {};
    backtestWindowSize = [5, 10, 15, 20].includes(Number(payload.backtestWindowSize)) ? Number(payload.backtestWindowSize) : 20;
    loadedCoordinateSpace = payload.coordinateSpace || "surface";
    loadedChartIssues = Array.isArray(payload.chartIssues) ? payload.chartIssues.map(String) : null;
  };
  const refreshAfterHistory = () => {
    renderPredictionPanel();
    for (let line = 1; line <= 3; line += 1) syncPickLineDom(line);
    drawAll();
  };
  const restoreHistorySnapshot = (snapshot) => {
    restoringHistory = true;
    applyRecordPayload(JSON.parse(snapshot));
    refreshAfterHistory();
    // applyRecordPayload 会做标准化，使用标准化后的状态作为当前历史节点，避免重做时被再次记成新操作。
    historySnapshot = historyKey(buildHistorySnapshot());
    scheduleSave();
    restoringHistory = false;
  };
  const undoLastAction = () => {
    if (!historyPast.length) return setStatus("没有可撤销的操作");
    historyFuture.push(historySnapshot);
    trimHistory(historyFuture);
    restoreHistorySnapshot(historyPast.pop());
    setStatus("已撤销");
  };
  const redoLastAction = () => {
    if (!historyFuture.length) return setStatus("没有可重做的操作");
    historyPast.push(historySnapshot);
    trimHistory(historyPast);
    restoreHistorySnapshot(historyFuture.pop());
    setStatus("已重做");
  };
  const hasRecordContent = (payload) => recordHasContent(payload, DEFAULT_STRATEGIES.length);
  const load = async () => {
    try {
      const payload = await recordRepository.load(hasRecordContent);
      if (!payload) return;
      applyRecordPayload(payload);
    } catch (error) {
      console.warn(error);
      actions = [];
    }
  };
  const migrateLoadedCoordinates = () => {
    if (loadedCoordinateSpace === "chartHost") return;
    const offset = chartOffset();
    actions.forEach((action) => moveAction(action, -offset.x, -offset.y));
    loadedCoordinateSpace = "chartHost";
    scheduleSave();
  };
  const commitAction = (action) => { actions.push(action); currentPath = null; previewPoint = null; isDrawing = false; drawAll(); scheduleSave(); };
  const beginText = (point, existingIndex = -1) => {
    if (editingTextIndex >= 0) { activeTextBox?.focus(); return; }
    const box = document.createElement("textarea");
    const existing = existingIndex >= 0 ? actions[existingIndex] : null;
    const style = existing ? { color: existing.color, width: existing.width } : getStyle();
    const fontSize = Math.max(14, style.width * 4);
    const editIndex = existingIndex >= 0 ? existingIndex : actions.length;
    if (existingIndex < 0) actions.push({ type: "text", x: point.x, y: point.y, text: "", ...style });
    const surfacePoint = toSurfacePoint(point);
    const editorTop = surfacePoint.y - Math.round(fontSize * .125);
    let finished = false;
    box.className = "text-box";
    activeTextBox = box;
    box.value = existing?.text || "";
    box.setAttribute("aria-label", "文字标注输入框");
    box.style.left = `${surfacePoint.x}px`;
    box.style.top = `${editorTop}px`;
    box.style.color = style.color;
    box.style.fontSize = `${fontSize}px`;
    box.style.visibility = "hidden";
    chartSurface.appendChild(box);
    const resizeTextBox = () => {
      const fontSize = Math.max(14, style.width * 4);
      const lineHeight = Math.max(18, style.width * 5);
      const lines = String(box.value || "").split("\n");
      ctx.save();
      ctx.font = `${fontSize}px "Microsoft YaHei", Arial, sans-serif`;
      const contentWidth = Math.max(ctx.measureText("一").width, ...lines.map((line) => ctx.measureText(line || " ").width));
      ctx.restore();
      box.style.width = `${Math.min(460, Math.max(22, Math.ceil(contentWidth + 4)))}px`;
      box.style.height = "auto";
      box.style.height = `${Math.min(260, Math.max(22, box.scrollHeight, lines.length * lineHeight + 4))}px`;
      actions[editIndex] = { ...actions[editIndex], text: box.value };
      drawAll();
    };
    resizeTextBox();
    const maxLeft = Math.max(12, chartSurface.scrollWidth - box.offsetWidth - 12);
    const maxTop = Math.max(12, chartSurface.scrollHeight - box.offsetHeight - 12);
    box.style.left = `${Math.min(Math.max(12, surfacePoint.x), maxLeft)}px`;
    box.style.top = `${Math.min(Math.max(0, editorTop), maxTop)}px`;
    editingTextIndex = editIndex;
    selectedIndex = editIndex;
    drawAll();
    box.style.visibility = "visible";
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
    const finish = () => {
      if (finished) return;
      finished = true;
      const text = box.value.trim();
      box.remove();
      activeTextBox = null;
      if (text) actions[editIndex] = { ...actions[editIndex], text };
      else actions.splice(editIndex, 1);
      editingTextIndex = -1;
      selectedIndex = -1;
      drawAll();
      scheduleSave();
    };
    box.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); finish(); }
      if (event.key === "Escape") {
        event.preventDefault();
        finished = true;
        if (existingIndex >= 0) actions[existingIndex] = { ...actions[existingIndex], text: existing.text };
        else actions.splice(editIndex, 1);
        box.remove();
        activeTextBox = null;
        editingTextIndex = -1;
        selectedIndex = -1;
        drawAll();
      }
    });
    box.addEventListener("input", resizeTextBox);
    box.addEventListener("blur", finish, { once: true });
  };
  const selectAnnotationAtPoint = (point) => {
    const hitIndex = hitActionIndex(point);
    if (hitIndex < 0) return false;
    selectedIndex = hitIndex;
    editMode = null;
    drawAll();
    setStatus("已选中标注，可拖动移动或拖四角缩放");
    return true;
  };
  const beginEditAtPoint = (point) => {
    const selectedBounds = actionBounds(actions[selectedIndex]);
    if (!selectedBounds) return false;
    const handle = selectionHandle(point, selectedBounds);
    if (handle) {
      editMode = `resize:${handle}`;
      editStartPoint = point;
      editOriginalAction = cloneAction(actions[selectedIndex]);
      editOriginalBounds = selectedBounds;
      editHasMoved = false;
      return true;
    }
    if (!pointInBounds(point, selectedBounds, 0)) return false;
    editMode = "move";
    editStartPoint = point;
    editOriginalAction = cloneAction(actions[selectedIndex]);
    editOriginalBounds = selectedBounds;
    editHasMoved = false;
    return true;
  };
  const onPointerDown = (event) => {
    if (event.detail > 1) { event.preventDefault(); return; }
    const point = getPoint(event);
    if (currentTool === "hand" && annotationsVisible && beginEditAtPoint(point)) {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    const chartActionTarget = elementBelowCanvas(event);
    if (handlePickRowAction(chartActionTarget)) return;
    const pickCell = chartActionTarget?.closest?.("[data-pick-line]");
    if (pickCell) { togglePickCell(pickCell); return; }
    if (currentTool === "text" && hitTextIndex(point) >= 0) return;
    if (selectedIndex >= 0) {
      selectedIndex = -1;
      editMode = null;
      drawAll();
      setStatus("已取消选中");
      return;
    }
    if (!annotationsVisible || currentTool === "hand") return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    if (currentTool === "text") { beginText(point); return; }
    isDrawing = true;
    startPoint = point;
    previewPoint = point;
    if (currentTool === "pen") currentPath = { type: "pen", points: [point], ...getStyle() };
    drawAll();
  };
  const onPointerMove = (event) => {
    if (isDrawing || editMode) event.preventDefault();
    const point = getPoint(event);
    updateSelectionCursor(point);
    if (editMode && selectedIndex >= 0) {
      const dx = point.x - editStartPoint.x;
      const dy = point.y - editStartPoint.y;
      if (!editHasMoved && Math.hypot(dx, dy) < 4) return;
      editHasMoved = true;
      actions[selectedIndex] = cloneAction(editOriginalAction);
      if (editMode === "move") moveAction(actions[selectedIndex], dx, dy);
      if (editMode.startsWith("resize:")) {
        const handle = editMode.split(":")[1];
        const targetBounds = boundsFromHandle(editOriginalBounds, handle, point);
        if (actions[selectedIndex].type === "text") scaleTextAction(actions[selectedIndex], editOriginalBounds, targetBounds, handle);
        else scaleAction(actions[selectedIndex], editOriginalBounds, targetBounds);
      }
      drawAll();
      return;
    }
    if (!isDrawing) return;
    previewPoint = drawingPoint(point, event);
    if (currentTool === "pen" && currentPath) currentPath.points.push(point);
    drawAll();
  };
  const onPointerUp = (event) => {
    if (editMode) {
      editMode = null;
      editStartPoint = null;
      editOriginalAction = null;
      editOriginalBounds = null;
      editHasMoved = false;
      canvas.style.cursor = "";
      scheduleSave();
      return;
    }
    if (!isDrawing) return;
    const point = drawingPoint(getPoint(event), event);
    if (currentTool === "pen" && currentPath) { commitAction(currentPath); return; }
    const dx = Math.abs(point.x - startPoint.x), dy = Math.abs(point.y - startPoint.y);
    if (dx < 3 && dy < 3) { currentPath = null; previewPoint = null; isDrawing = false; drawAll(); return; }
    commitAction({ type: currentTool, start: startPoint, end: point, ...getStyle() });
  };
  const setPickCellDisplay = (cell, selected) => {
    const number = Number(cell.dataset.pickNumber);
    const color = cell.dataset.pickColor;
    cell.classList.toggle("pick-selected", selected);
    cell.innerHTML = selected ? `<span class="hit ${color}">${String(number).padStart(2, "0")}</span>` : number;
  };
  const syncPickLineDom = (line) => {
    chartHost.querySelectorAll(`[data-pick-line="${line}"]`).forEach((cell) => {
      const color = cell.dataset.pickColor;
      const number = Number(cell.dataset.pickNumber);
      setPickCellDisplay(cell, picks[line]?.[color]?.includes(number));
    });
  };
  const swapPickLines = (firstLine = 1, secondLine = 2) => {
    const first = picks[firstLine] || { red: [], blue: [] };
    const second = picks[secondLine] || { red: [], blue: [] };
    picks[firstLine] = { red: [...second.red], blue: [...second.blue] };
    picks[secondLine] = { red: [...first.red], blue: [...first.blue] };
    syncPickLineDom(firstLine);
    syncPickLineDom(secondLine);
    scheduleSave();
    setStatus(`\u9884\u9009${firstLine}\u548c\u9884\u9009${secondLine}\u5df2\u8c03\u6362`);
  };
  const clearPickLine = (line) => {
    if (!picks[line]) return;
    picks[line] = { red: [], blue: [] };
    syncPickLineDom(line);
    scheduleSave();
    setStatus(`\u9884\u9009${line}\u5df2\u6e05\u9664`);
  };
  const handlePickRowAction = (target) => {
    const swapButton = target?.closest?.('[data-pick-swap]');
    if (swapButton) {
      const [firstLine, secondLine] = String(swapButton.dataset.pickSwap || '1-2').split('-').map(Number);
      swapPickLines(firstLine || 1, secondLine || 2);
      return true;
    }
    const clearButton = target?.closest?.('[data-pick-clear]');
    if (clearButton) {
      clearPickLine(Number(clearButton.dataset.pickClear));
      return true;
    }
    return false;
  };
  const togglePickCell = (cell) => {
    const line = Number(cell.dataset.pickLine);
    const color = cell.dataset.pickColor;
    const number = Number(cell.dataset.pickNumber);
    const list = picks[line][color];
    const index = list.indexOf(number);
    const selected = index < 0;
    const limit = color === "red" ? 6 : 1;
    if (selected && list.length >= limit) { setStatus(`${PICK_LINE_LABELS[line]}最多选择${limit}个${color === "red" ? "红球" : "蓝球"}`); return; }
    if (selected) list.push(number);
    else list.splice(index, 1);
    list.sort((a, b) => a - b);
    setPickCellDisplay(cell, selected);
    scheduleSave();
    setStatus(`图表预选${line}已更新`);
  };
  const restoreRecordPayload = (payload) => {
    applyRecordPayload(payload);
    renderChart();
    migrateLoadedCoordinates();
    syncLoadedAnnotationsToCurrentChart();
    resizeCanvas();
    drawAll();
    save();
    setStatus("已导入记录文件");
  };
  const saveRecordFile = async () => {
    const json = JSON.stringify(buildRecordPayload(), null, 2);
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: RECORD_FILE_NAME,
          types: [{ description: "双色球标注记录", accept: { "application/json": [".json"] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        setStatus("记录文件已保存");
        return;
      } catch (error) {
        if (error?.name === "AbortError") return setStatus("已取消保存记录");
        console.warn(error);
      }
    }
    const link = document.createElement("a");
    link.download = RECORD_FILE_NAME;
    link.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus("记录文件已下载");
  };
  const readRecordFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try { restoreRecordPayload(JSON.parse(String(reader.result || "{}"))); }
      catch (error) { console.warn(error); setStatus("记录文件格式不正确"); }
    });
    reader.readAsText(file, "utf-8");
  };
  const openRecordFile = async () => {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: "双色球标注记录", accept: { "application/json": [".json"] } }]
        });
        readRecordFile(await handle.getFile());
        return;
      } catch (error) {
        if (error?.name === "AbortError") return setStatus("已取消导入记录");
        console.warn(error);
      }
    }
    recordInput.click();
  };
  const elementBelowCanvas = (event) => {
    const previous = canvas.style.pointerEvents;
    canvas.style.pointerEvents = "none";
    const element = document.elementFromPoint(event.clientX, event.clientY);
    canvas.style.pointerEvents = previous;
    return element;
  };
  const selectTool = (button) => {
    currentTool = button.dataset.tool;
    selectedIndex = -1;
    editMode = null;
    canvas.classList.toggle("hand-mode", currentTool === "hand");
    canvas.style.cursor = "";
    canvas.classList.remove("select-mode");
    toolButtons.forEach((item) => item.classList.toggle("active", item === button));
    setStatus(`当前工具：${button.title}`);
  };
  const selectAnnotation = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!annotationsVisible) return;
    if (editingTextIndex >= 0) { activeTextBox?.focus(); return; }
    const point = getPoint(event);
    const hitIndex = currentTool === "text" ? hitTextIndex(point) : hitActionIndex(point);
    if (currentTool === "text" && hitIndex >= 0) {
      selectedIndex = -1;
      drawAll();
      beginText({ x: actions[hitIndex].x, y: actions[hitIndex].y }, hitIndex);
      return;
    }
    if (!selectAnnotationAtPoint(point)) {
      selectedIndex = -1;
      editMode = null;
      drawAll();
      setStatus("已取消选中");
    }
  };
  const deleteAnnotation = () => {
    if (!actions.length) return setStatus("没有可删除的标记");
    const deleteIndex = selectedIndex >= 0 ? selectedIndex : actions.length - 1;
    actions.splice(deleteIndex, 1);
    selectedIndex = -1;
    editMode = null;
    drawAll();
    scheduleSave();
    setStatus("已删除标记");
  };
  const handleShortcut = (event) => {
    const isEditable = ["INPUT", "TEXTAREA"].includes(event.target.tagName);
    const isDeleteKey = event.key === "Delete" || event.key === "Backspace" || event.code === "Delete" || event.code === "Backspace";
    if (!isEditable && event.metaKey && isDeleteKey) {
      event.preventDefault();
      event.stopPropagation();
      deleteAnnotation();
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "z") { event.preventDefault(); undoLastAction(); }
    if (key === "y") { event.preventDefault(); redoLastAction(); }
    if (key === "s") { event.preventDefault(); save(); }
  };
  const bindEvents = () => {
    predictionPanel.addEventListener("click", (event) => {
      const addStrategyButton = event.target.closest('[data-action="add-strategy"]');
      if (addStrategyButton) { openStrategyDialog(); return; }
      const editStrategyButton = event.target.closest('[data-action="edit-selected-strategy"]');
      if (editStrategyButton) { editSelectedStrategy(); return; }
      const deleteStrategyButton = event.target.closest('[data-action="delete-selected-strategy"]');
      if (deleteStrategyButton) { removeSelectedStrategy(); return; }
      const selectAllStrategyButton = event.target.closest('[data-action="select-all-strategies"]');
      if (selectAllStrategyButton) { selectAllStrategies(); return; }
      const clearSelectedStrategyButton = event.target.closest('[data-action="clear-selected-strategies"]');
      if (clearSelectedStrategyButton) { clearSelectedStrategies(); return; }
      const fillModelButton = event.target.closest('[data-action="fill-model-pick"]');
      if (fillModelButton) { fillModelPredictionToPickLine(); return; }
      const clearPredictionButton = event.target.closest('[data-action="clear-prediction"]');
      if (clearPredictionButton) { clearLastModelPick(); return; }
      const saveModelButton = event.target.closest('[data-action="save-model-backtest"]');
      if (saveModelButton) { saveModelPredictionForBacktest(); return; }
      const backtestWindowButton = event.target.closest("button[data-backtest-window]");
      if (backtestWindowButton) { backtestWindowSize = Number(backtestWindowButton.dataset.backtestWindow) || 20; renderPredictionPanel(); scheduleSave(); return; }
      const strategyToggle = event.target.closest('button[data-strategy-id]');
      if (strategyToggle) { toggleStrategySelection(strategyToggle.dataset.strategyId); return; }
    });
    predictionPanel.addEventListener("focusin", (event) => {
      const editor = event.target.closest("[data-prediction-line]");
      if (editor) startPredictionLineEdit(editor);
    });
    predictionPanel.addEventListener("focusout", (event) => {
      const aiInput = event.target.closest("[data-ai-inline-input]");
      // focusout 发生在 click 之前；此时重绘模型区会替换掉正要接收 click 的按钮。
      if (aiInput) { updateAiInlineInput(aiInput, false, false); return; }
      const editor = event.target.closest("[data-prediction-line]");
      if (editor) renderPredictionLineAsBalls(editor);
    });
    predictionPanel.addEventListener("keydown", (event) => {
      const aiInput = event.target.closest("[data-ai-inline-input]");
      if (aiInput && event.key === "Enter") { event.preventDefault(); updateAiInlineInput(aiInput); return; }
      const editor = event.target.closest("[data-prediction-line]");
      if (editor && event.key === "Enter") {
        event.preventDefault();
        renderPredictionLineAsBalls(editor);
      }
    });
    predictionPanel.addEventListener("input", (event) => {
      const input = event.target.closest("[data-prediction-line]");
      if (input) { updatePredictionLineFromInput(input, true); return; }
      const aiInput = event.target.closest("[data-ai-inline-input]");
      if (aiInput) { updateAiInlineInput(aiInput, true); return; }
      if (event.target.id === "predictionIssue") { predictionIssue = event.target.value.trim(); scheduleSave(); }
    });
    predictionPanel.addEventListener("paste", (event) => {
      const editor = event.target.closest("[data-prediction-line]");
      if (!editor) return;
      event.preventDefault();
      insertPlainTextAtCaret(event.clipboardData?.getData("text/plain") || "");
      updatePredictionLineFromInput(editor, true);
    });
    chartHost.addEventListener("click", (event) => {
      if (handlePickRowAction(event.target)) return;
      const cell = event.target.closest("[data-pick-line]");
      if (cell) togglePickCell(cell);
    });
    toolButtons.forEach((button) => button.addEventListener("click", () => selectTool(button)));
    swatchButtons.forEach((button) => button.addEventListener("click", () => {
      strokeColor = button.dataset.color;
      swatchButtons.forEach((item) => item.classList.toggle("active", item === button));
      setStatus(`标注颜色：${button.title}`);
    }));
    toggleButton.addEventListener("click", () => {
      annotationsVisible = !annotationsVisible;
      canvas.classList.toggle("hidden-layer", !annotationsVisible);
      toggleText.textContent = annotationsVisible ? "隐藏" : "显示";
      setStatus(annotationsVisible ? "标注层已显示" : "标注层已隐藏");
    });
    recordInput.addEventListener("change", () => { readRecordFile(recordInput.files?.[0]); recordInput.value = ""; });
    exportButton.addEventListener("click", () => {
      const link = document.createElement("a");
      link.download = `ssq-analysis-${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      setStatus("已导出标注PNG");
    });
    const refreshWithStatus = () => refreshLotteryData().catch((error) => { console.warn(error); setStatus("刷新失败，请稍后重试"); });
    refreshLatestButton.addEventListener("click", refreshWithStatus);
    refreshChartButton.addEventListener("click", refreshWithStatus);
    document.addEventListener("keydown", handleShortcut);
    chartHost.addEventListener("dblclick", selectAnnotation);
    canvas.addEventListener("dblclick", selectAnnotation);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("resize", scheduleResize);
    chartSurface.parentElement.addEventListener("scroll", schedulePickActionButtonPosition);
    new ResizeObserver(scheduleResize).observe(chartHost);
  };
  const init = async () => {
    versionBadge.textContent = APP_VERSION;
    bindEvents();
    await load();
    renderChart();
    migrateLoadedCoordinates();
    syncLoadedAnnotationsToCurrentChart();
    resizeCanvas();
    drawAll();
    historyPast = [];
    historyFuture = [];
    historySnapshot = historyKey(buildHistorySnapshot());
    setStatus(actions.length ? "已恢复上次标注" : "自动保存已开启");
  };
  init();
})();
