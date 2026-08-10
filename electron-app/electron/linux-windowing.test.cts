const assert = require("node:assert/strict");
const test = require("node:test");

const { configureLinuxWindowing, shouldForceXWayland } = require("./linux-windowing.cjs");

test("uses XWayland when screen overlays require window positioning", () => {
  const calls = [];
  const app = {
    commandLine: {
      hasSwitch: () => false,
      appendSwitch: (...args) => calls.push(args),
    },
  };

  assert.equal(
    configureLinuxWindowing(app, {
      platform: "linux",
      environment: { XDG_SESSION_TYPE: "wayland", DISPLAY: ":0" },
    }),
    "x11",
  );
  assert.deepEqual(calls, [["ozone-platform", "x11"]]);
});

test("preserves explicit windowing choices and native non-Linux backends", () => {
  const waylandEnvironment = { XDG_SESSION_TYPE: "wayland", DISPLAY: ":0" };
  assert.equal(
    shouldForceXWayland({
      platform: "linux",
      environment: waylandEnvironment,
      hasOzonePlatformSwitch: true,
    }),
    false,
  );
  assert.equal(
    shouldForceXWayland({
      platform: "linux",
      environment: { XDG_SESSION_TYPE: "wayland" },
    }),
    false,
  );
  assert.equal(
    shouldForceXWayland({
      platform: "linux",
      environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" },
    }),
    false,
  );
  assert.equal(shouldForceXWayland({ platform: "darwin", environment: waylandEnvironment }), false);
});
