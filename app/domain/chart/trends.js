export const buildHotRedMap = (rows) => {
  const redRows = rows.map((row) => new Set(row.red.map(Number)));
  const hot = new Set();
  const markRun = (run) => {
    if (run.length >= 3) run.forEach(([rowIndex, number]) => hot.add(`${rowIndex}:${number}`));
  };
  redRows.forEach((redSet, rowIndex) => {
    let run = [];
    for (let number = 1; number <= 33; number += 1) {
      if (redSet.has(number)) run.push([rowIndex, number]);
      else { markRun(run); run = []; }
    }
    markRun(run);
  });
  for (const step of [0, 1, -1]) {
    for (let rowIndex = 0; rowIndex < redRows.length; rowIndex += 1) {
      for (let number = 1; number <= 33; number += 1) {
        if (!redRows[rowIndex].has(number)) continue;
        const prevRow = rowIndex - 1;
        const prevNumber = number - step;
        if (prevRow >= 0 && prevNumber >= 1 && prevNumber <= 33 && redRows[prevRow].has(prevNumber)) continue;
        const run = [];
        let nextRow = rowIndex;
        let nextNumber = number;
        while (nextRow < redRows.length && nextNumber >= 1 && nextNumber <= 33 && redRows[nextRow].has(nextNumber)) {
          run.push([nextRow, nextNumber]);
          nextRow += 1;
          nextNumber += step;
        }
        markRun(run);
      }
    }
  }
  return hot;
};
