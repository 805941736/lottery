export const APP_VERSION = "v3.0";
export const OLD_STORAGE_KEYS = Object.freeze([
  "ssq-analysis-annotations-v1",
  "ssq-analysis-annotations-v5",
  "ssq-analysis-annotations-v4",
  "ssq-analysis-annotations-v3",
  "ssq-analysis-annotations-v2"
]);
export const MARKER_STYLE = Object.freeze({ width: 3, defaultColor: "#79aee8" });
export const API_ENDPOINTS = Object.freeze({ refresh: "/api/refresh", records: "/api/records" });
export const RECORD_FILE_NAME = "ssq-analysis-records.json";
export const HISTORY_LIMITS = Object.freeze({ entries: 60, bytes: 3 * 1024 * 1024 });
