(() => {
  const STORAGE_KEY = "ssq-analysis-portable-record";
  const STORAGE_SCHEMA_VERSION = 10;
  const PICK_LINES = Object.freeze([1, 2, 3]);
  const createPick = () => ({ red: [], blue: [] });
  const createPicks = () => Object.fromEntries(PICK_LINES.map((line) => [line, createPick()]));
  const uniqueSorted = (items, max) => [...new Set((items || []).map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= max))].sort((a, b) => a - b);
  const normalizePick = (pick) => ({
    red: uniqueSorted(pick?.red, 33).slice(0, 6),
    blue: uniqueSorted(pick?.blue, 16).slice(0, 1)
  });
  const normalizePicks = (source) => {
    const picks = { ...createPicks(), ...(source || {}) };
    PICK_LINES.forEach((line) => { picks[line] = normalizePick(picks[line]); });
    return picks;
  };
  const parsePickInput = (value) => {
    const raw = String(value || "").trim();
    const digits = raw.replace(/\D/g, "");
    const values = raw && /^\d{14}$/.test(digits) ? digits.match(/\d{2}/g).map(Number) : (raw.match(/\d{1,2}/g) || []).map(Number);
    return normalizePick({ red: values.slice(0, 6), blue: values.slice(6, 7) });
  };
  const formatPickInput = (pick) => [...normalizePick(pick).red, ...normalizePick(pick).blue].map((value) => String(value).padStart(2, "0")).join(" ");
  const compactIssueKey = (issue) => {
    const digits = String(issue || "").replace(/\D/g, "");
    return digits.length > 5 && digits.startsWith("20") ? digits.slice(-5) : digits;
  };
  const htmlEscape = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  const readRecord = () => {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch { return {}; }
  };
  const writeRecord = (patch) => {
    const current = readRecord();
    const next = { ...current, ...patch, version: STORAGE_SCHEMA_VERSION, savedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  };
  window.SSQCore = Object.freeze({
    STORAGE_KEY,
    STORAGE_SCHEMA_VERSION,
    PICK_LINES,
    createPick,
    createPicks,
    uniqueSorted,
    normalizePick,
    normalizePicks,
    parsePickInput,
    formatPickInput,
    compactIssueKey,
    htmlEscape,
    readRecord,
    writeRecord
  });
})();
