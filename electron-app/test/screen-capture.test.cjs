const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createDisplayCapturePlan,
  getOrderedDisplays,
  getThumbnailSize,
} = require("../electron/screen-capture.cjs");

function display(id, x, y, width = 1920, height = 1080, scaleFactor = 1) {
  return {
    id,
    bounds: { x, y, width, height },
    scaleFactor,
    size: {
      width: Math.round(width * scaleFactor),
      height: Math.round(height * scaleFactor),
    },
  };
}

test("orders displays by their OS coordinates, including negative and vertical origins", () => {
  const ordered = getOrderedDisplays([
    display("right", 1920, 100),
    display("left", -1920, 100),
    display("top", 0, -1080),
  ]);

  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ["top", "left", "right"],
  );
  assert.deepEqual(
    ordered.map((entry) => entry.displayIndex),
    [0, 1, 2],
  );
  assert.equal(
    ordered.every((entry) => entry.displayCount === 3),
    true,
  );
});

test("matches reordered desktop sources by Electron display_id", () => {
  const plan = createDisplayCapturePlan(
    [display(20, 1920, 0), display(10, -1920, 0)],
    [
      { id: "screen:88:0", display_id: "20", marker: "right" },
      { id: "screen:12:0", display_id: "10", marker: "left" },
    ],
  );

  assert.deepEqual(
    plan.map((entry) => [entry.id, entry.source.marker, entry.bounds.x]),
    [
      ["10", "left", -1920],
      ["20", "right", 1920],
    ],
  );
});

test("uses screen source identity only as an all-or-nothing fallback", () => {
  const displays = [display("2", -1920, 0), display("8", 0, 0)];
  const sources = [
    { id: "screen:8:0", display_id: "", marker: "right" },
    { id: "screen:2:0", display_id: "", marker: "left" },
  ];

  const fallbackPlan = createDisplayCapturePlan(displays, sources);
  assert.deepEqual(
    fallbackPlan.map((entry) => [entry.id, entry.source.marker]),
    [
      ["2", "left"],
      ["8", "right"],
    ],
  );

  assert.deepEqual(
    createDisplayCapturePlan([display("left", -1920, 0), display("right", 0, 0)], sources),
    [],
  );

  const partialIdPlan = createDisplayCapturePlan(
    [display(10, -1920, 0), display(20, 0, 0)],
    [
      { id: "screen:2:0", display_id: "10", marker: "left" },
      { id: "screen:8:0", display_id: "", marker: "unknown" },
    ],
  );
  assert.deepEqual(
    partialIdPlan.map((entry) => entry.id),
    ["10"],
  );
});

test("accepts the unambiguous single-display fallback and numeric display IDs", () => {
  const singleDisplayPlan = createDisplayCapturePlan(
    [display("laptop", 0, 0)],
    [{ id: "screen:7:0", display_id: "", marker: "laptop" }],
  );
  assert.equal(singleDisplayPlan[0]?.source.marker, "laptop");

  const numericDisplayIdPlan = createDisplayCapturePlan(
    [display(7, 0, 0)],
    [{ id: "screen:7:0", display_id: 7, marker: "laptop" }],
  );
  assert.equal(numericDisplayIdPlan[0]?.source.marker, "laptop");
});

test("requests thumbnails large enough for the highest-DPI display", () => {
  assert.deepEqual(
    getThumbnailSize([
      display("standard", 0, 0, 1920, 1080, 1),
      display("retina", 1920, 0, 1280, 720, 2),
    ]),
    { width: 2560, height: 1440 },
  );
});
