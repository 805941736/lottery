import assert from "node:assert/strict";
import { buildHotRedMap } from "../app/domain/chart/trends.js";
import { evaluateBacktestPick, normalizeBacktestRecord, summarizeBacktestResults } from "../app/domain/backtest/evaluator.js";
import { applyStrategyScores, buildNumberStats, topNumbersByScore } from "../app/domain/strategy/strategy-engine.js";
import { historyKey, trimHistory } from "../app/services/history-service.js";
import { chooseRecordPayload, isLocalApplicationServer, parseRecordPayload } from "../app/services/record-repository.js";
import { hasRecordContent } from "../app/state/record-schema.js";
import { rectFromPoints, snapLinePoint } from "../app/features/annotation/annotation-renderer.js";
import { buildChartTable } from "../app/domain/chart/chart-table.js";
import { completePick, getNextPredictionIssue, parsePredictionEditorText } from "../app/domain/prediction/picks.js";

const rows = [
  { issue: "26001", red: [1, 2, 3, 10, 20, 30], blue: 5 },
  { issue: "26002", red: [2, 3, 4, 11, 21, 31], blue: 6 },
  { issue: "26003", red: [3, 4, 5, 12, 22, 32], blue: 7 }
];

assert.ok(buildHotRedMap(rows).has("0:1"));
const table = buildChartTable(rows, { 1: { red: [], blue: [] }, 2: { red: [], blue: [] }, 3: { red: [], blue: [] } });
assert.match(table.html, /26003/);
assert.equal(table.redMiss[1], 2);
assert.deepEqual(normalizeBacktestRecord({ red: [2, 2, 1, 34], blue: [16, 17] }), { red: [1, 2], blue: [16], source: "已保存预测", savedAt: "" });
const evaluated = evaluateBacktestPick({ red: [1, 8, 20], blue: [5] }, rows[0]);
assert.equal(evaluated.totalHits, 3);
assert.equal(summarizeBacktestResults([evaluated]).issueCount, 1);

const stats = buildNumberStats(rows);
const strategies = [{ id: "hot", name: "热号", mode: "hot", weight: 1 }];
applyStrategyScores({ historyRows: rows, ...stats, strategyIds: ["hot"], strategyLibrary: strategies, predictionLines: {}, isAiStrategy: () => false });
assert.equal(topNumbersByScore(stats.redStats.slice(1), 6).length, 6);

assert.equal(historyKey({ a: 1 }), '{"a":1}');
assert.deepEqual(trimHistory(["123", "456"], { entries: 1, bytes: 10 }), ["456"]);
assert.equal(parseRecordPayload("{"), null);
assert.equal(isLocalApplicationServer({ protocol: "http:", hostname: "127.0.0.1" }), true);
assert.equal(chooseRecordPayload({ savedAt: "2026-01-01", actions: [1] }, null, (item) => Boolean(item?.actions?.length)).actions.length, 1);
assert.equal(hasRecordContent({ picks: { 1: { red: [1] } } }), true);
assert.equal(completePick({ red: [1, 2, 3, 4, 5, 6], blue: [7] }), true);
assert.equal(getNextPredictionIssue("2026078", ""), "2026079");
assert.deepEqual(parsePredictionEditorText("01 02 03 04 05 06 07").pick, { red: [1, 2, 3, 4, 5, 6], blue: [7] });

assert.deepEqual(rectFromPoints({ x: 5, y: 6 }, { x: 2, y: 1 }), { x: 2, y: 1, w: 3, h: 5 });
assert.deepEqual(snapLinePoint({ x: 0, y: 0 }, { x: 10, y: .1 }), { x: Math.hypot(10, .1), y: 0 });

console.log("module tests passed");
