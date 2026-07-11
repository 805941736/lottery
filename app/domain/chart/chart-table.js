import { buildHotRedMap } from "./trends.js";

export const buildChartTable = (rows, picks) => {
  const redMiss = Array(34).fill(0);
  const blueMiss = Array(17).fill(0);
  const hotRedMap = buildHotRedMap(rows);
  let html = '<table class="chart-table"><thead><tr><th class="issue-col">期号</th>';
  for (let number = 1; number <= 33; number += 1) html += `<th>${number}</th>`;
  html += '<th class="sep"></th>';
  for (let number = 1; number <= 16; number += 1) html += `<th>${number}</th>`;
  html += "</tr></thead><tbody>";
  rows.forEach((row, index) => {
    const redSet = new Set(row.red.map(Number));
    const blueNumber = Number(row.blue);
    const rowClasses = [index === rows.length - 1 ? "latest-row" : "", (index + 1) % 5 === 0 ? "five-sep" : ""].filter(Boolean).join(" ");
    html += `<tr class="${rowClasses}"><td class="issue-col">${row.issue}</td>`;
    for (let number = 1; number <= 33; number += 1) {
      if (redSet.has(number)) {
        redMiss[number] = 0;
        html += `<td><span class="hit red ${hotRedMap.has(`${index}:${number}`) ? "hot-red" : ""}">${String(number).padStart(2, "0")}</span></td>`;
      } else {
        redMiss[number] += 1;
        html += `<td class="miss">${redMiss[number]}</td>`;
      }
    }
    html += '<td class="sep"></td>';
    for (let number = 1; number <= 16; number += 1) {
      if (blueNumber === number) {
        blueMiss[number] = 0;
        html += `<td><span class="hit blue trend-blue">${String(number).padStart(2, "0")}</span></td>`;
      } else {
        blueMiss[number] += 1;
        html += `<td class="miss">${blueMiss[number]}</td>`;
      }
    }
    html += "</tr>";
  });
  for (let line = 1; line <= 3; line += 1) {
    html += `<tr class="pick-row"><td class="issue-col">预选${line}</td>`;
    for (let number = 1; number <= 33; number += 1) {
      const selected = picks[line].red.includes(number);
      html += `<td class="pick-cell ${selected ? "pick-selected" : ""}" data-pick-line="${line}" data-pick-color="red" data-pick-number="${number}">${selected ? `<span class="hit red">${String(number).padStart(2, "0")}</span>` : number}</td>`;
    }
    html += '<td class="sep"></td>';
    for (let number = 1; number <= 16; number += 1) {
      const selected = picks[line].blue.includes(number);
      html += `<td class="pick-cell ${selected ? "pick-selected" : ""}" data-pick-line="${line}" data-pick-color="blue" data-pick-number="${number}">${selected ? `<span class="hit blue">${String(number).padStart(2, "0")}</span>` : number}</td>`;
    }
    html += "</tr>";
  }
  return { html: `${html}</tbody></table>`, redMiss, blueMiss };
};
