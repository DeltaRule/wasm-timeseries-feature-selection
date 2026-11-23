export const CANONICAL_ORDER = Object.freeze(["mean", "min", "max", "slope"]);

function canonicalRank(name) {
  const index = CANONICAL_ORDER.indexOf(name);
  return index === -1 ? CANONICAL_ORDER.length : index;
}

function compareCanonical(a, b) {
  return (
    canonicalRank(a.name) - canonicalRank(b.name) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
}

function compareRanking(a, b) {
  return b.score - a.score || compareCanonical(a, b);
}

export function selectFeatures(features) {
  if (
    features === null ||
    typeof features !== "object" ||
    Array.isArray(features)
  ) {
    throw new TypeError("features must be an object of finite numbers");
  }

  const entries = Object.keys(features).map((name) => {
    const value = features[name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(
        `features.${name} must be a finite number, received ${String(value)}`,
      );
    }
    return { name, value };
  });

  let maxMagnitude = 0;
  for (const { value } of entries) {
    const magnitude = Math.abs(value);
    if (magnitude > maxMagnitude) maxMagnitude = magnitude;
  }

  if (maxMagnitude === 0) {
    return entries
      .sort(compareCanonical)
      .map(({ name, value }) => ({ name, value, score: 0 }));
  }

  const weights = entries.map(({ value }) => Math.abs(value) / maxMagnitude);
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  return entries
    .map(({ name, value }, i) => ({ name, value, score: weights[i] / total }))
    .sort(compareRanking);
}

export const scoreFeatures = selectFeatures;
