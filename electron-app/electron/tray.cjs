const DEFAULT_TRAY_STATE = Object.freeze({
  minimizeOnClose: false,
  minimizeToTray: false,
  showTotpInTray: false,
  locked: false,
  accounts: [],
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeTrayAccount(value) {
  if (!isObject(value)) {
    return undefined;
  }

  const id = normalizeText(value.id, 256);
  const label = normalizeText(value.label, 512);
  const code = normalizeText(value.code, 64);
  if (!id || !label || !code) {
    return undefined;
  }

  return { id, label, code };
}

function normalizeTrayState(value) {
  const input = isObject(value) ? value : {};
  const accounts = [];
  const accountIds = new Set();

  if (Array.isArray(input.accounts)) {
    for (const item of input.accounts) {
      const account = normalizeTrayAccount(item);
      if (!account || accountIds.has(account.id)) {
        continue;
      }

      accountIds.add(account.id);
      accounts.push(account);
    }
  }

  return {
    minimizeOnClose: input.minimizeOnClose === true,
    minimizeToTray: input.minimizeToTray === true,
    showTotpInTray: input.showTotpInTray === true,
    locked: input.locked === true,
    accounts,
  };
}

function shouldKeepTray(state) {
  return state.minimizeOnClose || state.minimizeToTray || state.showTotpInTray;
}

function orderAccountsByIds(accounts, preferredOrderIds = []) {
  const accountById = new Map(
    accounts
      .filter((account) => isObject(account) && typeof account.id === "string")
      .map((account) => [account.id, account]),
  );
  const ordered = [];
  const usedIds = new Set();

  for (const id of preferredOrderIds) {
    const account = accountById.get(id);
    if (account && !usedIds.has(id)) {
      usedIds.add(id);
      ordered.push(account);
    }
  }

  return [
    ...ordered,
    ...accounts.filter((account) => isObject(account) && !usedIds.has(account.id)),
  ];
}

function areTrayStatesEqual(left, right) {
  if (
    left.minimizeOnClose !== right.minimizeOnClose ||
    left.minimizeToTray !== right.minimizeToTray ||
    left.showTotpInTray !== right.showTotpInTray ||
    left.locked !== right.locked ||
    left.accounts.length !== right.accounts.length
  ) {
    return false;
  }

  return left.accounts.every(
    (account, index) =>
      account.id === right.accounts[index].id &&
      account.label === right.accounts[index].label &&
      account.code === right.accounts[index].code,
  );
}

function buildTrayMenuTemplate(state, handlers) {
  const template = [
    {
      label: "Open WinOTP",
      click: handlers.open,
    },
  ];

  if (state.showTotpInTray && !state.locked && state.accounts.length > 0) {
    template.push({ type: "separator" });
    for (const account of state.accounts) {
      const accountId = account.id;
      template.push({
        label: `${account.label}  —  ${account.code}`,
        click: () => handlers.copy(accountId),
      });
    }
  }

  template.push(
    { type: "separator" },
    {
      label: "Exit",
      click: handlers.exit,
    },
  );

  return template;
}

function createTrayController({
  Tray,
  Menu,
  iconPath,
  onOpen,
  onCopy,
  onExit,
  onMenuOpen,
  onError,
  tooltip = "WinOTP",
}) {
  let tray;
  let trayCreationFailed = false;
  let state = { ...DEFAULT_TRAY_STATE, accounts: [] };

  function reportError(error) {
    try {
      onError?.(error);
    } catch {
      // Error reporting must not make tray cleanup or state updates fail.
    }
  }

  function refreshMenu() {
    if (!tray || (typeof tray.isDestroyed === "function" && tray.isDestroyed())) {
      return;
    }

    try {
      const menu = Menu.buildFromTemplate(
        buildTrayMenuTemplate(state, {
          open: onOpen,
          copy: onCopy,
          exit: onExit,
        }),
      );
      tray.setContextMenu(menu);
    } catch (error) {
      reportError(error);
    }
  }

  function ensureTray() {
    if (trayCreationFailed) {
      return;
    }
    if (tray && typeof tray.isDestroyed === "function" && tray.isDestroyed()) {
      tray = undefined;
    }
    if (tray) {
      return;
    }

    let nextTray;
    try {
      nextTray = new Tray(iconPath);
      nextTray.setToolTip(tooltip);
      nextTray.on("double-click", onOpen);
      nextTray.on("right-click", () => {
        try {
          onMenuOpen?.();
        } catch (error) {
          reportError(error);
        } finally {
          refreshMenu();
        }
      });
      tray = nextTray;
    } catch (error) {
      try {
        nextTray?.destroy();
      } catch {
        // Preserve the original tray creation failure.
      }
      tray = undefined;
      trayCreationFailed = true;
      reportError(error);
    }
  }

  function disposeTray() {
    if (tray && !(typeof tray.isDestroyed === "function" && tray.isDestroyed())) {
      try {
        tray.destroy();
      } catch (error) {
        reportError(error);
      }
    }
    tray = undefined;
    trayCreationFailed = false;
  }

  return {
    setState(value) {
      const nextState = normalizeTrayState(value);
      const stateChanged = !areTrayStatesEqual(state, nextState);
      const hadTray = Boolean(
        tray && !(typeof tray.isDestroyed === "function" && tray.isDestroyed()),
      );
      state = nextState;
      if (shouldKeepTray(state)) {
        ensureTray();
        if (!hadTray || stateChanged) {
          refreshMenu();
        }
      } else {
        disposeTray();
      }
    },
    getState() {
      return state;
    },
    refreshMenu,
    dispose: disposeTray,
  };
}

module.exports = {
  buildTrayMenuTemplate,
  createTrayController,
  normalizeTrayState,
  orderAccountsByIds,
  areTrayStatesEqual,
  shouldKeepTray,
};
