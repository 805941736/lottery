const required = (id) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少必需的页面元素 #${id}`);
  return element;
};

export const getAppDom = () => {
  const canvas = required("drawCanvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持 Canvas 2D");
  return Object.freeze({
    workspace: required("workspace"), chartSurface: required("chartSurface"),
    chartHost: required("chartHost"), predictionPanel: required("predictionPanel"),
    chartMeta: required("chartMeta"), canvas, ctx,
    swatchButtons: Array.from(document.querySelectorAll(".swatch-button")),
    toolButtons: Array.from(document.querySelectorAll(".tool-button")),
    versionBadge: required("versionBadge"), statusText: required("statusText"),
    toggleButton: required("toggleButton"), toggleText: required("toggleText"),
    exportButton: required("exportButton"), refreshChartButton: required("refreshChartButton"),
    latestIssue: required("latestIssue"), latestBalls: required("latestBalls"),
    refreshLatestButton: required("refreshLatestButton"), recordInput: required("recordInput")
  });
};
