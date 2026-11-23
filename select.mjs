/**
 * Finite numeric feature values keyed by feature name.
 *
 * The six built-in keys are listed in {@link CANONICAL_ORDER}, but extra keys
 * are intentionally accepted as a backwards-compatible custom-feature
 * extension point and are scored exactly like built-in ones.
 *
 * @typedef {Object<string, number>} FeatureValues
 */

/**
 * One entry of the ranking returned by {@link selectFeatures}.
 *
 * @typedef {object} ScoredFeature
 * @property {string} name - The feature key from the input object.
 * @property {number} value - The original (unmodified) feature value.
 * @property {number} score - Magnitude-normalized usefulness in `[0, 1]`.
 */

/**
 * Canonical tie-break order for the six built-in features. This frozen array
 * is an ordering, not an allow-list: unknown keys rank after every canonical
 * key and then alphabetically.
 *
 * @type {ReadonlyArray<string>}
 */
export const CANONICAL_ORDER = Object.freeze([
  "mean",
  "min",
  "max",
  "slope",
  "variance",
  "stddev",
]);

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

/**
 * Scores and ranks features by magnitude-normalized usefulness.
 *
 * Each weight is `|value| / max(|values|)` and each score is
 * `weight / sum(weights)`, so scores lie in `[0, 1]` and sum to `1` for any
 * non-zero input (up to floating-point rounding). Entries are sorted by
 * descending score; ties are broken by {@link CANONICAL_ORDER} first, then
 * alphabetically for unknown keys. All-zero features score `0` in that same
 * canonical-then-alphabetical order, and an empty object yields `[]`.
 *
 * This function is fully synchronous: it returns an array, not a promise, and
 * never mutates the input (which may be frozen).
 *
 * @param {FeatureValues} features - Object mapping feature names to finite
 *   numbers. Must be a non-null, non-array object; unknown keys are allowed.
 * @returns {ScoredFeature[]} A fresh array of `{ name, value, score }` entries
 *   ranked by descending usefulness with canonical-then-alphabetical ties.
 * @throws {TypeError} If `features` is not a non-null object (arrays included),
 *   or if any value is not a number or is non-finite.
 */
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

/**
 * Alias for {@link selectFeatures} with identical synchronous behavior,
 * scoring rules, tie-breaking and validation.
 *
 * @param {FeatureValues} features - Object mapping feature names to finite
 *   numbers; see {@link selectFeatures} for the full contract.
 * @returns {ScoredFeature[]} A fresh, ranked array of scored entries.
 * @throws {TypeError} Under the same conditions as {@link selectFeatures}.
 */
export const scoreFeatures = selectFeatures;
