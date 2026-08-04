const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildTrayMenuTemplate,
  createTrayController,
  normalizeTrayState,
  shouldKeepTray,
} = require("./tray.cjs");

test("normalizes tray state and removes invalid or duplicate accounts", () => {
  const state = normalizeTrayState({
    minimizeToTray: true,
    showTotpInTray: true,
    accounts: [
      { id: "one", label: "First", code: "123456" },
      { id: "one", label: "Duplicate", code: "654321" },
      { id: "", label: "Missing id", code: "000000" },
      { id: "two", label: "Second", code: "" },
    ],
  });

  assert.deepEqual(state, {
    minimizeOnClose: false,
    minimizeToTray: true,
    showTotpInTray: true,
    locked: false,
    accounts: [{ id: "one", label: "First", code: "123456" }],
  });
  assert.equal(shouldKeepTray(state), true);
  assert.equal(shouldKeepTray(normalizeTrayState({ showTotpInTray: true })), true);
});

test("builds open, copy, and exit items while hiding codes when locked", () => {
  const copied = [];
  const exited = [];
  const handlers = {
    open: () => undefined,
    copy: (id) => copied.push(id),
    exit: () => exited.push(true),
  };
  const state = normalizeTrayState({
    showTotpInTray: true,
    accounts: [{ id: "one", label: "First", code: "123456" }],
  });
  const template = buildTrayMenuTemplate(state, handlers);

  assert.deepEqual(
    template.map((item) => item.label ?? item.type),
    ["Open WinOTP", "separator", "First  —  123456", "separator", "Exit"],
  );
  template[2].click();
  template[4].click();
  assert.deepEqual(copied, ["one"]);
  assert.deepEqual(exited, [true]);

  const lockedTemplate = buildTrayMenuTemplate(
    normalizeTrayState({ ...state, locked: true }),
    handlers,
  );
  assert.deepEqual(
    lockedTemplate.map((item) => item.label ?? item.type),
    ["Open WinOTP", "separator", "Exit"],
  );
});

test("creates and disposes the tray as close settings change", () => {
  const trays = [];
  const menus = [];
  const copied = [];
  const callbacks = {};
  let menuOpenCount = 0;

  class FakeTray {
    constructor(iconPath) {
      this.iconPath = iconPath;
      this.handlers = {};
      this.destroyed = false;
      trays.push(this);
    }

    on(event, handler) {
      this.handlers[event] = handler;
    }

    setToolTip(tooltip) {
      this.tooltip = tooltip;
    }

    setContextMenu(menu) {
      this.menu = menu;
      menus.push(menu);
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const controller = createTrayController({
    Tray: FakeTray,
    Menu: {
      buildFromTemplate(template) {
        return { template };
      },
    },
    iconPath: "app.ico",
    onOpen: () => (callbacks.opened = true),
    onCopy: (id) => copied.push(id),
    onExit: () => (callbacks.exited = true),
    onMenuOpen: () => {
      menuOpenCount += 1;
    },
  });

  controller.setState({
    minimizeOnClose: false,
    minimizeToTray: true,
    showTotpInTray: true,
    accounts: [{ id: "one", label: "First", code: "123456" }],
  });
  assert.equal(trays.length, 1);
  assert.equal(trays[0].tooltip, "WinOTP");
  assert.equal(menus.at(-1).template.length, 5);

  trays[0].handlers["double-click"]();
  assert.equal(callbacks.opened, true);
  trays[0].handlers["right-click"]();
  assert.equal(menuOpenCount, 1);
  menus.at(-1).template[2].click();
  assert.deepEqual(copied, ["one"]);

  controller.setState({ minimizeOnClose: false, minimizeToTray: false });
  assert.equal(trays[0].destroyed, true);
  controller.dispose();
});

test("recreates a tray destroyed by the operating system", () => {
  const trays = [];

  class FakeTray {
    constructor() {
      this.destroyed = false;
      this.handlers = {};
      trays.push(this);
    }

    on(event, handler) {
      this.handlers[event] = handler;
    }

    setToolTip() {}

    setContextMenu(menu) {
      this.menu = menu;
    }

    isDestroyed() {
      return this.destroyed;
    }
  }

  const controller = createTrayController({
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => ({ template }) },
    iconPath: "app.ico",
    onOpen: () => undefined,
    onCopy: () => undefined,
    onExit: () => undefined,
  });
  const state = { showTotpInTray: true, accounts: [] };

  controller.setState(state);
  trays[0].destroyed = true;
  controller.setState(state);

  assert.equal(trays.length, 2);
  assert.ok(trays[1].menu);
});

test("reports tray construction failures without throwing", () => {
  const errors = [];
  class FailingTray {
    constructor() {
      throw new Error("tray unavailable");
    }
  }

  const controller = createTrayController({
    Tray: FailingTray,
    Menu: { buildFromTemplate: (template) => ({ template }) },
    iconPath: "app.ico",
    onOpen: () => undefined,
    onCopy: () => undefined,
    onExit: () => undefined,
    onError: (error) => errors.push(error),
  });

  assert.doesNotThrow(() => controller.setState({ showTotpInTray: true }));
  assert.equal(errors.length, 1);
  controller.setState({ showTotpInTray: true });
  assert.equal(errors.length, 1);
  controller.setState({ showTotpInTray: false });
  controller.setState({ showTotpInTray: true });
  assert.equal(errors.length, 2);
});
