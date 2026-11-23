import { readFile } from "node:fs/promises";

const WASM_PATH = new URL("./wasm/timeseries.wasm", import.meta.url);
const INPUT_PTR = 0;
const OUTPUT_PTR = 1024;
const BYTES_PER_VALUE = 8;
const PAGE_SIZE = 64 * 1024;

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

function toWindow(window) {
  if (typeof window !== "number" || !Number.isInteger(window)) {
    throw new TypeError("window must be an integer number");
  }
  return window >= 1 ? window : null;
}

export async function loadTimeseries() {
  const bytes = await readFile(WASM_PATH);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const { memory, sum, moving_average } = instance.exports;
  let view = new DataView(memory.buffer);

  function ensureCapacity(byteLength) {
    if (byteLength <= view.byteLength) return;
    const pages = Math.ceil((byteLength - view.byteLength) / PAGE_SIZE);
    memory.grow(pages);
    view = new DataView(memory.buffer);
  }

  function writeInput(series) {
    ensureCapacity(INPUT_PTR + series.length * BYTES_PER_VALUE);
    for (let i = 0; i < series.length; i += 1) {
      view.setFloat64(INPUT_PTR + i * BYTES_PER_VALUE, series[i], true);
    }
  }

  return {
    sum(values) {
      const series = toSeries(values);
      writeInput(series);
      return sum(INPUT_PTR, series.length);
    },

    movingAverage(values, window) {
      const series = toSeries(values);
      const size = toWindow(window);
      if (size === null || size > series.length || series.length === 0) {
        return [];
      }

      writeInput(series);
      const outPtr = Math.max(OUTPUT_PTR, series.length * BYTES_PER_VALUE);
      const count = series.length - size + 1;
      ensureCapacity(outPtr + count * BYTES_PER_VALUE);

      const written = moving_average(INPUT_PTR, series.length, size, outPtr);
      const results = new Array(Math.max(0, written));
      for (let i = 0; i < results.length; i += 1) {
        results[i] = view.getFloat64(outPtr + i * BYTES_PER_VALUE, true);
      }
      return results;
    },
  };
}
