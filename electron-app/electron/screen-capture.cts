const maxThumbnailDimension = 4096;
const screenSourceIdPattern = /^screen:(\d+):/;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeBounds(bounds) {
  if (
    !bounds ||
    !isFiniteNumber(bounds.x) ||
    !isFiniteNumber(bounds.y) ||
    !isFiniteNumber(bounds.width) ||
    !isFiniteNumber(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return undefined;
  }

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function getDisplayId(display) {
  if (display?.id === undefined || display?.id === null) {
    return undefined;
  }

  return String(display.id);
}

function compareDisplayEntries(left, right) {
  return (
    left.bounds.y - right.bounds.y ||
    left.bounds.x - right.bounds.x ||
    left.id.localeCompare(right.id, "en", { numeric: true })
  );
}

function getOrderedDisplays(displays) {
  return displays
    .map((display) => {
      const bounds = normalizeBounds(display?.bounds);
      const id = getDisplayId(display);
      return bounds && id !== undefined
        ? { display, bounds, id, scaleFactor: getDisplayScaleFactor(display) }
        : undefined;
    })
    .filter((entry) => entry !== undefined)
    .sort(compareDisplayEntries)
    .map((entry, displayIndex, orderedDisplays) => ({
      ...entry,
      displayIndex,
      displayCount: orderedDisplays.length,
    }));
}

function getDisplayScaleFactor(display) {
  return isFiniteNumber(display?.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1;
}

function getThumbnailDimension(displays, dimension) {
  return Math.max(
    ...displays.map(({ display, bounds }) => {
      const configuredSize = display?.size?.[dimension];
      const scaledBounds = Math.ceil(bounds[dimension] * getDisplayScaleFactor(display));
      return Math.max(
        bounds[dimension],
        scaledBounds,
        isFiniteNumber(configuredSize) && configuredSize > 0 ? configuredSize : 0,
      );
    }),
  );
}

function getThumbnailSize(displays) {
  const orderedDisplays = getOrderedDisplays(displays);
  if (orderedDisplays.length === 0) {
    return { width: 1, height: 1 };
  }

  return {
    width: Math.max(
      1,
      Math.min(maxThumbnailDimension, Math.ceil(getThumbnailDimension(orderedDisplays, "width"))),
    ),
    height: Math.max(
      1,
      Math.min(maxThumbnailDimension, Math.ceil(getThumbnailDimension(orderedDisplays, "height"))),
    ),
  };
}

function getSourceDisplayId(source) {
  if (source?.display_id === undefined || source?.display_id === null) {
    return undefined;
  }

  const displayId = String(source.display_id);
  return displayId.length > 0 ? displayId : undefined;
}

function getScreenSourceSequence(source) {
  if (typeof source?.id !== "string") {
    return undefined;
  }

  const match = screenSourceIdPattern.exec(source.id);
  return match ? match[1] : undefined;
}

function getFallbackSourceByDisplayId(sources, orderedDisplays) {
  if (sources.some((source) => getSourceDisplayId(source) !== undefined)) {
    return undefined;
  }

  if (orderedDisplays.length === 1 && sources.length === 1) {
    return new Map([[orderedDisplays[0].id, sources[0]]]);
  }

  const displayIds = new Set(orderedDisplays.map((entry) => entry.id));
  const sourceEntries = sources.map((source) => ({
    source,
    sequence: getScreenSourceSequence(source),
  }));
  if (
    sourceEntries.length !== orderedDisplays.length ||
    sourceEntries.some((entry) => entry.sequence === undefined)
  ) {
    return undefined;
  }

  const sourceByDisplayId = new Map();
  for (const entry of sourceEntries) {
    const displayId = entry.sequence;
    if (!displayIds.has(displayId) || sourceByDisplayId.has(displayId)) {
      return undefined;
    }

    sourceByDisplayId.set(displayId, entry.source);
  }

  return sourceByDisplayId.size === displayIds.size ? sourceByDisplayId : undefined;
}

function findDisplaySource(sources, displayId, usedSources = new Set(), fallbackSourceByDisplayId) {
  const matchingSource = sources.find(
    (source) => getSourceDisplayId(source) === displayId && !usedSources.has(source),
  );
  if (matchingSource) {
    return matchingSource;
  }

  // Electron documents display_id as the portable Display-to-source key. If a
  // platform cannot provide it, only accept a numeric source identity when it
  // exactly matches the set of OS display IDs. Never infer a mapping from array
  // order or visual coordinates: either can change independently by platform.
  const fallbackSource = fallbackSourceByDisplayId?.get(displayId);
  return fallbackSource && !usedSources.has(fallbackSource) ? fallbackSource : undefined;
}

function createDisplayCapturePlan(displays, sources) {
  const orderedDisplays = getOrderedDisplays(displays);
  const fallbackSourceByDisplayId = getFallbackSourceByDisplayId(sources, orderedDisplays);
  const usedSources = new Set();

  return orderedDisplays.flatMap((entry) => {
    const source = findDisplaySource(sources, entry.id, usedSources, fallbackSourceByDisplayId);
    if (!source) {
      return [];
    }

    usedSources.add(source);
    return [{ ...entry, source }];
  });
}

module.exports = {
  createDisplayCapturePlan,
  findDisplaySource,
  getOrderedDisplays,
  getThumbnailSize,
  normalizeBounds,
};
