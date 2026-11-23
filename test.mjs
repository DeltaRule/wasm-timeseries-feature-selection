import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
