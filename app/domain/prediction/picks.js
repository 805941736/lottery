const uniqueSorted = (items, max) => [...new Set((items || []).map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= max))].sort((a, b) => a - b);

export const pickInputValue = (pick) => [...uniqueSorted(pick?.red, 33), ...uniqueSorted(pick?.blue, 16)].map((number) => String(number).padStart(2, "0")).join(" ");
export const completePick = (pick) => uniqueSorted(pick?.red, 33).length === 6 && uniqueSorted(pick?.blue, 16).length === 1;

export const getNextPredictionIssue = (latestIssue, lastChartIssue) => {
  const raw = String(latestIssue || lastChartIssue || "").replace(/\D/g, "");
  const issue = Number(raw.length === 5 ? `20${raw}` : raw);
  return Number.isFinite(issue) && issue > 0 ? String(issue + 1) : "";
};

export const parsePredictionEditorText = (value) => {
  const raw = String(value || "").replace(/\u00a0/g, " ").trimStart();
  const parts = raw.includes(" ") ? raw.split(/\s+/).filter(Boolean) : raw.replace(/\D/g, "").split("");
  const red = [], blue = [], pending = [];
  parts.slice(0, 7).forEach((part, index) => {
    const digits = part.replace(/\D/g, "").slice(0, 2);
    if (!digits) return;
    const number = Number(digits);
    if (index < 6) {
      if (number >= 1 && number <= 33 && !red.includes(number)) red.push(number);
      else pending.push(digits);
    } else if (number >= 1 && number <= 16) blue.push(number);
    else pending.push(digits);
  });
  return { pick: { red: red.sort((a, b) => a - b), blue: blue.slice(0, 1) }, pending: pending.join(" ") };
};
