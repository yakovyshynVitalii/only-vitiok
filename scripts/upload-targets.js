function buildCreateUrl(baseUrl, collectionId) {
  const trimmedBase = String(baseUrl || "").replace(/\/+$/, "");
  const trimmedCollection = String(collectionId || "").trim();

  if (!trimmedBase || !trimmedCollection) return "";
  return `${trimmedBase}/collection/${trimmedCollection}`;
}

function extractCollectionId(createUrl) {
  const match = String(createUrl || "").match(/\/collection\/([^/?#]+)/i);
  return match ? match[1] : "";
}

function normalizeAssetCount(value) {
  if (value == null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function normalizeRangePoint(value) {
  const normalized = normalizeAssetCount(value);
  if (normalized == null) return null;
  return normalized <= 0 ? 1 : normalized;
}

function normalizeTarget(target, env) {
  const collectionId = String(target?.collectionId || "").trim();
  const explicitCreateUrl = String(target?.createUrl || "").trim();
  const createUrl =
    explicitCreateUrl || buildCreateUrl(env?.BASE_URL, collectionId);
  let rangeStart = normalizeRangePoint(target?.rangeStart);
  let rangeEnd = normalizeRangePoint(target?.rangeEnd);

  if (rangeStart == null && rangeEnd == null) {
    const legacyAssetCount = normalizeAssetCount(target?.assetCount);
    if (legacyAssetCount != null) {
      rangeStart = 1;
      rangeEnd = legacyAssetCount === 0 ? 1 : legacyAssetCount;
    }
  }

  if (rangeStart != null && rangeEnd != null && rangeEnd < rangeStart) {
    rangeEnd = rangeStart;
  }

  if (!collectionId && !createUrl) return null;

  return {
    collectionId: collectionId || extractCollectionId(createUrl),
    createUrl,
    rangeStart,
    rangeEnd,
  };
}

function parseDistributionMode(value) {
  return String(value || "").trim().toLowerCase() === "even" ? "even" : "range";
}

function parseUploadTargets(env) {
  const rawTargets = String(env?.UPLOAD_COLLECTIONS || "").trim();
  const distributionMode = parseDistributionMode(env?.UPLOAD_DISTRIBUTION_MODE);

  if (rawTargets) {
    let parsed;
    try {
      parsed = JSON.parse(rawTargets);
    } catch (error) {
      throw new Error(
        `UPLOAD_COLLECTIONS must be valid JSON array: ${error.message}`
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error("UPLOAD_COLLECTIONS must be a JSON array");
    }

    const normalized = parsed
      .map((target) => normalizeTarget(target, env))
      .filter(Boolean);

    if (normalized.length) {
      return {
        distributionMode,
        targets: normalized,
      };
    }
  }

  const fallbackTarget = normalizeTarget(
    {
      collectionId: env?.COLLECTION_ID,
      createUrl: env?.CREATE_URL,
      rangeStart: null,
      rangeEnd: null,
    },
    env
  );

  if (!fallbackTarget) {
    throw new Error(
      "No upload collections configured. Add CREATE_URL or UPLOAD_COLLECTIONS to .env"
    );
  }

  return {
    distributionMode,
    targets: [fallbackTarget],
  };
}

function describeTarget(target, index) {
  return (
    String(target?.collectionId || "").trim() ||
    extractCollectionId(target?.createUrl) ||
    `Collection ${index + 1}`
  );
}

function planEvenUploads(items, targets) {
  const total = items.length;
  const base = Math.floor(total / targets.length);
  const remainder = total % targets.length;
  const plans = [];
  let cursor = 0;

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const size = base + (index < remainder ? 1 : 0);
    const targetItems = items.slice(cursor, cursor + size);
    cursor += size;

    plans.push({
      ...target,
      targetIndex: index,
      label: describeTarget(target, index),
      items: targetItems,
    });
  }

  return {
    plans,
    assignedCount: total,
    unassignedItems: [],
  };
}

function planRangeUploads(items, targets) {
  const plans = [];
  const taken = new Set();

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const start = Math.max((target.rangeStart ?? 1) - 1, 0);
    const end =
      target.rangeEnd != null
        ? Math.min(target.rangeEnd - 1, items.length - 1)
        : items.length - 1;
    const targetItems = [];

    for (let cursor = start; cursor <= end; cursor += 1) {
      if (cursor < 0 || cursor >= items.length || taken.has(cursor)) continue;
      taken.add(cursor);
      targetItems.push(items[cursor]);
    }

    plans.push({
      ...target,
      targetIndex: index,
      label: describeTarget(target, index),
      items: targetItems,
    });
  }

  const unassignedItems = items.filter((_, index) => !taken.has(index));

  return {
    plans,
    assignedCount: items.length - unassignedItems.length,
    unassignedItems,
  };
}

function planUploads(items, targets, distributionMode = "range") {
  const sourceItems = Array.isArray(items) ? items : [];
  const sourceTargets = Array.isArray(targets) ? targets : [];

  if (!sourceItems.length || !sourceTargets.length) {
    return {
      plans: [],
      assignedCount: 0,
      unassignedItems: sourceItems,
    };
  }

  if (distributionMode === "even") {
    return planEvenUploads(sourceItems, sourceTargets);
  }

  return planRangeUploads(sourceItems, sourceTargets);
}

module.exports = {
  buildCreateUrl,
  describeTarget,
  extractCollectionId,
  normalizeAssetCount,
  normalizeRangePoint,
  parseDistributionMode,
  parseUploadTargets,
  planUploads,
};
