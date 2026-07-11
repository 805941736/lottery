"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const window = {};
const sandbox = { window, localStorage: { getItem: () => null, setItem: () => {} } };
vm.createContext(sandbox);
for (const file of ["ssq-core.js", "annotation-geometry.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/core", file), "utf8"), sandbox, { filename: file });
}
const core = window.SSQCore;
const geometry = window.SSQAnnotationGeometry;
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(plain(core.normalizePick({ red: [6, 1, 6, 34, "2"], blue: [16, 17] })), {
  red: [1, 2, 6],
  blue: [16]
});
assert.deepEqual(plain(core.parsePickInput("01020304050607")), {
  red: [1, 2, 3, 4, 5, 6],
  blue: [7]
});
assert.equal(core.compactIssueKey("2026078"), "26078");
assert.equal(core.htmlEscape('<a title="x">&'), "&lt;a title=&quot;x&quot;&gt;&amp;");

assert.deepEqual(plain(geometry.normalizeBounds({ x: 10, y: 8, w: -4, h: -3 })), {
  x: 6, y: 5, w: 4, h: 3
});
assert.deepEqual(plain(geometry.pointsBounds([{ x: 2, y: 8 }, { x: 5, y: 3 }])), {
  x: 2, y: 3, w: 3, h: 5
});
assert.equal(geometry.pointsBounds([]), null);
assert.equal(geometry.pointInBounds({ x: 5, y: 5 }, { x: 2, y: 2, w: 4, h: 4 }), true);

console.log("core tests passed");
