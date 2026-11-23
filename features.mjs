import { loadTimeseries } from "./loader.mjs";

let loaderPromise;

function getLoader() {
  if (loaderPromise === undefined) {
    loaderPromise = loadTimeseries();
  }
  return loaderPromise;
}

/**
 * The six summary features extracted from a series.
 *
 * @typedef {object} FeatureValues
 * @property {number} mean - Arithmetic mean (WASM-backed sum divided by `n`).
 * @property {number} min - Smallest value in the series.
 * @property {number} max - Largest value in the series.
 * @property {number} slope - Ordinary least-squares slope of the values
 *   against their zero-based index (the linear trend).
 * @property {number} variance - Population variance: the mean of the squared
 *   deviations from `mean` (divides by `n`, not `n - 1`).
 * @property {number} stddev - Square root of `variance`.
 */

function toSeries(values) {
  if (
    values === null ||
    values === undefined ||
    typeof values[Symbol.iterator] !== "function"
  ) {
    throw new TypeError("values must be an iterable of finite numbers");
  }

  const series = [];
  let index = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(
        `values[${index}] must be a finite number, received ${String(value)}`,
      );
    }
    series.push(value);
    index += 1;
  }
  return series;
}

/**
 * Extracts summary features from a series of finite numbers.
 *
 * The input may be any iterable, including a one-shot generator, and is never
 * mutated. The loader promise is cached at module scope, so repeated calls
 * reuse a single WASM instance. `mean` uses the loader's WASM-backed `sum`;
 * `min`/`max` come from one scan, and `slope`, `variance` and `stddev` come
 * from the same second scan.
 *
 * @async
 * @param {Iterable<number>} values - Iterable of finite numbers.
 * @returns {Promise<FeatureValues>} A promise resolving to the feature object.
 *   An empty series yields all zeros (`{ mean: 0, min: 0, max: 0, slope: 0,
 *   variance: 0, stddev: 0 }`). A single-element series has
 *   `mean === min === max` and `slope === variance === stddev === 0`; a
 *   constant series likewise has zero slope, variance and stddev.
 * @throws {TypeError} As a promise rejection, if `values` is not iterable or
 *   any element is not a number or is non-finite.
 * @throws {RangeError} As a promise rejection, if the series is too large for
 *   the loader's 16-page (1 MiB) WASM memory ceiling.
 */
export async function extractFeatures(values) {
  const series = toSeries(values);
  const timeseries = await getLoader();
  const length = series.length;

  if (length === 0) {
    return { mean: 0, min: 0, max: 0, slope: 0, variance: 0, stddev: 0 };
  }

  let min = series[0];
  let max = series[0];
  for (let i = 1; i < length; i += 1) {
    if (series[i] < min) min = series[i];
    if (series[i] > max) max = series[i];
  }

  const mean = timeseries.sum(series) / length;

  let variance = 0;
  for (let i = 0; i < length; i += 1) {
    const deviation = series[i] - mean;
    variance += deviation * deviation;
  }
  variance /= length;
  const stddev = Math.sqrt(variance);

  let slope = 0;
  if (length > 1) {
    const indexMean = (length - 1) / 2;
    let covariance = 0;
    let indexVariance = 0;
    for (let i = 0; i < length; i += 1) {
      const dx = i - indexMean;
      covariance += dx * (series[i] - mean);
      indexVariance += dx * dx;
    }
    slope = covariance / indexVariance;
  }

  return { mean, min, max, slope, variance, stddev };
}
