import { loadTimeseries } from "./loader.mjs";

let loaderPromise;

function getLoader() {
  if (loaderPromise === undefined) {
    loaderPromise = loadTimeseries();
  }
  return loaderPromise;
}

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
