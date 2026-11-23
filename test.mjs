import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadTimeseries } from "./loader.mjs";
import { extractFeatures } from "./features.mjs";
import { selectFeatures, scoreFeatures, CANONICAL_ORDER } from "./select.mjs";

const bytes = await readFile(new URL("./wasm/timeseries.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, {});
const { memory, sum, moving_average } = instance.exports;

assert.ok(memory instanceof WebAssembly.Memory, "memory is exported");
assert.equal(typeof sum, "function", "sum is exported");
assert.equal(typeof moving_average, "function", "moving_average is exported");
assert.ok(memory.buffer.byteLength >= 128 * 1024, "memory is at least 2 pages");

const view = new DataView(memory.buffer);
const INPUT = 0;
const OUTPUT = 1024;

function writeSeries(values, ptr = INPUT) {
  values.forEach((value, i) => view.setFloat64(ptr + i * 8, value, true));
}

function readSeries(count, ptr = OUTPUT) {
  return Array.from({ length: count }, (_, i) =>
    view.getFloat64(ptr + i * 8, true),
  );
}

writeSeries([1.5, 2.5, 3, -1]);
assert.equal(sum(INPUT, 4), 6, "sum of four f64 values");
assert.equal(sum(INPUT, 0), 0, "sum of an empty range is 0");
assert.equal(sum(INPUT, 1), 1.5, "sum of a single value");
assert.equal(sum(INPUT, -1), 0, "sum rejects a negative length");

writeSeries([10, 20, 30], 2048);
assert.equal(sum(2048, 3), 60, "sum honors a non-zero byte offset");

writeSeries([1, 2, 3, 4]);
assert.equal(moving_average(INPUT, 4, 2, OUTPUT), 3, "window of 2 count");
assert.deepEqual(readSeries(3), [1.5, 2.5, 3.5], "window of 2 averages");
assert.deepEqual(readSeries(4, INPUT), [1, 2, 3, 4], "input is untouched");

assert.equal(moving_average(INPUT, 4, 1, OUTPUT), 4, "window of 1 count");
assert.deepEqual(readSeries(4), [1, 2, 3, 4], "window of 1 is the identity");

assert.equal(moving_average(INPUT, 4, 4, OUTPUT), 1, "full-window count");
assert.deepEqual(readSeries(1), [2.5], "full-window average");

for (const badWindow of [0, -1, 5]) {
  assert.equal(
    moving_average(INPUT, 4, badWindow, OUTPUT),
    0,
    `invalid window ${badWindow} returns 0`,
  );
}
assert.equal(moving_average(INPUT, 0, 1, OUTPUT), 0, "empty series returns 0");

writeSeries([2, 4, 6, 8], 512);
assert.equal(moving_average(512, 4, 2, 2048), 3, "offset input/output count");
assert.deepEqual(readSeries(3, 2048), [3, 5, 7], "offset input/output values");

console.log("WASM module checks passed");

const loader = await loadTimeseries();
assert.equal(typeof loader.sum, "function", "loader exposes sum");
assert.equal(
  typeof loader.movingAverage,
  "function",
  "loader exposes movingAverage",
);

assert.equal(loader.sum([1.5, 2.5, 3, -1]), 6, "loader sum of four values");
assert.equal(loader.sum([]), 0, "loader sum of empty input");
assert.equal(loader.sum([-2.5, 2.5]), 0, "loader sum with negatives");

assert.deepEqual(
  loader.movingAverage([1, 2, 3, 4], 2),
  [1.5, 2.5, 3.5],
  "loader moving average with window of 2",
);
assert.deepEqual(
  loader.movingAverage([1, 2, 3, 4], 1),
  [1, 2, 3, 4],
  "loader window of 1 is the identity",
);
assert.deepEqual(
  loader.movingAverage([1, 2, 3, 4], 4),
  [2.5],
  "loader full-window average",
);
assert.deepEqual(loader.movingAverage([], 1), [], "loader empty input");

for (const badWindow of [0, -1, 5]) {
  assert.deepEqual(
    loader.movingAverage([1, 2, 3, 4], badWindow),
    [],
    `loader invalid window ${badWindow} returns []`,
  );
}
assert.deepEqual(
  loader.movingAverage([1, 2, 3, 4], 2),
  [1.5, 2.5, 3.5],
  "loader does not return stale output after an invalid window",
);

const longSeries = Array.from({ length: 200 }, (_, i) => i + 1);
assert.equal(loader.sum(longSeries), 20100, "loader sum of a long series");
assert.deepEqual(
  loader.movingAverage(longSeries, 2),
  Array.from({ length: 199 }, (_, i) => i + 1.5),
  "loader moving average of a long series",
);

for (const bad of [
  null,
  undefined,
  {},
  "12",
  [1, "2"],
  [NaN],
  [Infinity],
  [-Infinity],
  [1, undefined],
]) {
  assert.throws(
    () => loader.sum(bad),
    /finite number/,
    `loader sum rejects ${String(bad)}`,
  );
  assert.throws(
    () => loader.movingAverage(bad, 1),
    /finite number/,
    `loader movingAverage rejects ${String(bad)}`,
  );
}

for (const badWindow of [NaN, Infinity, 1.5, "2", null]) {
  assert.throws(
    () => loader.movingAverage([1, 2, 3], badWindow),
    /integer number/,
    `loader rejects invalid window ${String(badWindow)}`,
  );
}

const otherLoader = await loadTimeseries();
assert.equal(otherLoader.sum([5]), 5, "a second loader instance works");
assert.deepEqual(
  otherLoader.movingAverage([5, 7], 2),
  [6],
  "loader instances have independent memory",
);
assert.equal(loader.sum([10]), 10, "first loader instance keeps its own state");

console.log("Loader checks passed");

assert.deepEqual(
  await extractFeatures([1, 2, 3, 4]),
  { mean: 2.5, min: 1, max: 4, slope: 1 },
  "features of an ascending representative series",
);
assert.deepEqual(
  await extractFeatures([10, 8.5, 6, 4, 2]),
  { mean: 6.1, min: 2, max: 10, slope: -2.05 },
  "features of a descending series with fractional values",
);
assert.deepEqual(
  await extractFeatures([3, 3, 3, 3]),
  { mean: 3, min: 3, max: 3, slope: 0 },
  "features of a constant series have zero slope",
);
assert.deepEqual(
  await extractFeatures([7]),
  { mean: 7, min: 7, max: 7, slope: 0 },
  "features of a single-element series",
);
assert.deepEqual(
  await extractFeatures([]),
  { mean: 0, min: 0, max: 0, slope: 0 },
  "features of an empty series are all zero",
);
assert.deepEqual(
  await extractFeatures(
    (function* () {
      yield 2;
      yield 4;
      yield 6;
    })(),
  ),
  { mean: 4, min: 2, max: 6, slope: 2 },
  "features accept a one-shot generator iterable",
);

const longFeatureSeries = Array.from({ length: 200 }, (_, i) => 2 * i + 1);
assert.deepEqual(
  await extractFeatures(longFeatureSeries),
  { mean: 200, min: 1, max: 399, slope: 2 },
  "features of a long linear series via the WASM-backed sum",
);

const mixedSeries = [-5, 2, -9, 4];
const mixedFeatures = await extractFeatures(mixedSeries);
assert.equal(mixedFeatures.mean, -2, "mean of mixed-sign series uses WASM sum");
assert.equal(mixedFeatures.min, -9, "min is the smallest negative value");
assert.equal(mixedFeatures.max, 4, "max is the largest positive value");
assert.deepEqual(mixedSeries, [-5, 2, -9, 4], "input series is not mutated");

for (const bad of [
  null,
  undefined,
  {},
  "12",
  [1, "2"],
  [NaN],
  [Infinity],
  [-Infinity],
  [1, undefined],
]) {
  await assert.rejects(
    () => extractFeatures(bad),
    (error) =>
      error instanceof TypeError && /finite number/.test(error.message),
    `extractFeatures rejects ${String(bad)}`,
  );
}

console.log("Feature extraction checks passed");

function assertRanking(actual, expected, expectedSum = 1) {
  assert.equal(actual.length, expected.length, "ranking has the expected length");
  for (let i = 0; i < expected.length; i += 1) {
    assert.equal(actual[i].name, expected[i].name, `rank ${i} name`);
    assert.equal(actual[i].value, expected[i].value, `rank ${i} value`);
    assert.ok(
      Math.abs(actual[i].score - expected[i].score) < 1e-12,
      `rank ${i} score ${actual[i].score} is ${expected[i].score}`,
    );
    assert.ok(
      actual[i].score >= 0 && actual[i].score <= 1,
      `rank ${i} score is in [0, 1]`,
    );
  }
  const total = actual.reduce((sum, entry) => sum + entry.score, 0);
  assert.ok(
    Math.abs(total - expectedSum) < 1e-12,
    `scores sum to ${expectedSum} (got ${total})`,
  );
}

assert.deepEqual(
  CANONICAL_ORDER,
  ["mean", "min", "max", "slope"],
  "canonical tie-break order",
);
assert.equal(scoreFeatures, selectFeatures, "scoreFeatures is an alias");

const positiveFeatures = { mean: 2.5, min: 1, max: 4, slope: 1 };
const positiveRanking = selectFeatures(positiveFeatures);
assertRanking(positiveRanking, [
  { name: "max", value: 4, score: 4 / 8.5 },
  { name: "mean", value: 2.5, score: 2.5 / 8.5 },
  { name: "min", value: 1, score: 1 / 8.5 },
  { name: "slope", value: 1, score: 1 / 8.5 },
]);
assert.deepEqual(
  positiveFeatures,
  { mean: 2.5, min: 1, max: 4, slope: 1 },
  "selectFeatures does not mutate its input",
);

const frozenFeatures = Object.freeze({ mean: 2.5, min: 1, max: 4, slope: 1 });
assert.deepEqual(
  selectFeatures(frozenFeatures),
  positiveRanking,
  "frozen feature objects are accepted",
);
assert.equal(
  typeof positiveRanking.then,
  "undefined",
  "selectFeatures is synchronous",
);
assert.deepEqual(
  selectFeatures(positiveFeatures),
  positiveRanking,
  "selectFeatures is deterministic",
);
assert.notEqual(
  selectFeatures(positiveFeatures),
  positiveRanking,
  "selectFeatures returns a fresh array",
);

const zeroFeatures = await extractFeatures([]);
assertRanking(
  selectFeatures(zeroFeatures),
  [
    { name: "mean", value: 0, score: 0 },
    { name: "min", value: 0, score: 0 },
    { name: "max", value: 0, score: 0 },
    { name: "slope", value: 0, score: 0 },
  ],
  0,
);
assert.deepEqual(
  zeroFeatures,
  { mean: 0, min: 0, max: 0, slope: 0 },
  "all-zero features are not mutated",
);

const constantRanking = selectFeatures(await extractFeatures([3, 3, 3, 3]));
assert.deepEqual(
  constantRanking.map(({ name }) => name),
  ["mean", "min", "max", "slope"],
  "zero slope ranks last for a constant series",
);
assertRanking(constantRanking, [
  { name: "mean", value: 3, score: 1 / 3 },
  { name: "min", value: 3, score: 1 / 3 },
  { name: "max", value: 3, score: 1 / 3 },
  { name: "slope", value: 0, score: 0 },
]);

assertRanking(selectFeatures(await extractFeatures(mixedSeries)), [
  { name: "min", value: -9, score: 9 / 16.6 },
  { name: "max", value: 4, score: 4 / 16.6 },
  { name: "mean", value: -2, score: 2 / 16.6 },
  { name: "slope", value: 1.6, score: 1.6 / 16.6 },
]);

const tieRanking = selectFeatures({ slope: 5, max: 5, min: 5, mean: 5 });
assert.deepEqual(
  tieRanking.map(({ name }) => name),
  ["mean", "min", "max", "slope"],
  "equal scores fall back to the canonical order",
);
assertRanking(tieRanking, [
  { name: "mean", value: 5, score: 0.25 },
  { name: "min", value: 5, score: 0.25 },
  { name: "max", value: 5, score: 0.25 },
  { name: "slope", value: 5, score: 0.25 },
]);

const extraFeatures = { slope: 1, extra: 2, max: 1, mean: 1, min: 1 };
const extraRanking = selectFeatures(extraFeatures);
assert.deepEqual(
  extraRanking.map(({ name }) => name),
  ["extra", "mean", "min", "max", "slope"],
  "additional keys are scored and sorted deterministically",
);
assertRanking(extraRanking, [
  { name: "extra", value: 2, score: 2 / 6 },
  { name: "mean", value: 1, score: 1 / 6 },
  { name: "min", value: 1, score: 1 / 6 },
  { name: "max", value: 1, score: 1 / 6 },
  { name: "slope", value: 1, score: 1 / 6 },
]);
assert.deepEqual(
  Object.keys(extraFeatures),
  ["slope", "extra", "max", "mean", "min"],
  "sorting does not reorder the input's keys",
);

assert.deepEqual(selectFeatures({}), [], "an empty feature object yields []");

const hugeRanking = selectFeatures({
  mean: 1e308,
  min: 1e308,
  max: 1e308,
  slope: 1e308,
});
assertRanking(hugeRanking, [
  { name: "mean", value: 1e308, score: 0.25 },
  { name: "min", value: 1e308, score: 0.25 },
  { name: "max", value: 1e308, score: 0.25 },
  { name: "slope", value: 1e308, score: 0.25 },
]);

for (const bad of [
  null,
  undefined,
  12,
  "12",
  true,
  [],
  [1, 2],
  () => {},
  { mean: NaN },
  { mean: Infinity },
  { mean: -Infinity },
  { mean: "1" },
  { mean: undefined },
  { mean: null },
  { mean: 1, min: 2, max: 3, slope: false },
]) {
  assert.throws(
    () => selectFeatures(bad),
    (error) =>
      error instanceof TypeError &&
      /must be an object|finite number/.test(error.message),
    `selectFeatures rejects ${String(bad)}`,
  );
  assert.throws(
    () => scoreFeatures(bad),
    TypeError,
    `scoreFeatures rejects ${String(bad)}`,
  );
}

console.log("Feature selection checks passed");
