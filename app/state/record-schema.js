export const hasRecordContent = (payload, defaultStrategyCount = 0) => {
  const groupsContainNumbers = (groups) => Object.values(groups || {}).some((group) =>
    ["red", "blue"].some((color) => Array.isArray(group?.[color]) && group[color].length > 0));
  return Boolean(
    (Array.isArray(payload?.actions) && payload.actions.length > 0)
    || groupsContainNumbers(payload?.picks)
    || groupsContainNumbers(payload?.predictionLines)
    || (Array.isArray(payload?.strategyLibrary) && payload.strategyLibrary.length > defaultStrategyCount)
    || (payload?.savedBacktestPredictions && Object.keys(payload.savedBacktestPredictions).length > 0)
  );
};
