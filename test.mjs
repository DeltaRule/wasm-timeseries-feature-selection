import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bytes = await readFile(new URL("./wasm/timeseries.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, {});
const { memory, sum, moving_average } = instance.exports;

assert.ok(memory instanceof WebAssembly.Memory, "memory is exported");
assert.equal(typeof sum, "function", "sum is exported");
assert.equal(typeof moving_average, "function", "moving_average is exported");

const view = new DataView(memory.buffer);
const inputPtr = 0;
const outputPtr = 1024;

function writeSeries(values, ptr = inputPtr) {
  values.forEach((value, i) => view.setFloat64(ptr + i * 8, value, true));
}

function readSeries(count, ptr = outputPtr) {
  return Array.from({ length: count }, (_, i) =>
    view.getFloat64(ptr + i * 8, true),
  );
}

writeSeries([1.5, 2.5, 3, -1]);
assert.equal(sum(inputPtr, 4), 6, "sum of four values");
assert.equal(sum(inputPtr, 0), 0, "sum of an empty range is 0");
assert.equal(sum(inputPtr, 1), 1.5, "sum of a single value");

writeSeries([1, 2, 3, 4]);
assert.equal(moving_average(inputPtr, 4, 2, outputPtr), 3, "result count");
assert.deepEqual(readSeries(3), [1.5, 2.5, 3.5], "window of 2");

assert.equal(moving_average(inputPtr, 4, 1, outputPtr), 4, "window of 1");
assert.deepEqual(readSeries(4), [1, 2, 3, 4], "window of 1 is identity");

assert.equal(moving_average(inputPtr, 4, 4, outputPtr), 1, "window equals len");
assert.deepEqual(readSeries(1), [2.5], "whole-series average");

assert.equal(moving_average(inputPtr, 4, 0, outputPtr), 0, "window of 0");
assert.equal(moving_average(inputPtr, 4, -1, outputPtr), 0, "negative window");
assert.equal(moving_average(inputPtr, 4, 5, outputPtr), 0, "window larger than len");

console.log("WASM smoke check passed");
