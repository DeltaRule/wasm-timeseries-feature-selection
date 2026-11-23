import { readFile } from "node:fs/promises";

const WASM_PATH = new URL("./wasm/timeseries.wasm", import.meta.url);
const INPUT_PTR = 0;
const OUTPUT_PTR = 1024;
const BYTES_PER_VALUE = 8;
const PAGE_SIZE = 64 * 1024;
const MAX_MEMORY_PAGES = 16;
const MAX_MEMORY_BYTES = MAX_MEMORY_PAGES * PAGE_SIZE;
const MAX_MEMORY_MIB = MAX_MEMORY_BYTES / (1024 * 1024);

/**
 * A WASM-backed time-series helper with its own independent linear memory.
 *
 * @typedef {object} Timeseries
 * @property {(values: Iterable<number>) => number} sum - Total of a series.
 * @property {(values: Iterable<number>, window: number) => number[]} movingAverage
 *   Sliding averages of a series.
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

function toWindow(window) {
  if (typeof window !== "number" || !Number.isInteger(window)) {
    throw new TypeError("window must be an integer number");
  }
  return window >= 1 ? window : null;
}

/**
 * Reads and instantiates `wasm/timeseries.wasm` relative to this module file,
 * so the caller's working directory does not matter.
 *
 * Every call resolves to a fresh instance with its own WASM linear memory; two
 * instances never share state. Loading is asynchronous because reading and
 * instantiating the binary is asynchronous, while the methods on the resolved
 * instance are synchronous.
 *
 * @async
 * @returns {Promise<Timeseries>} A promise resolving to an independent helper
 *   instance exposing {@link Timeseries#sum} and
 *   {@link Timeseries#movingAverage}.
 */
export async function loadTimeseries() {
  const bytes = await readFile(WASM_PATH);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const { memory, sum, moving_average } = instance.exports;
  let view = new DataView(memory.buffer);

  function ensureCapacity(byteLength) {
    if (byteLength > MAX_MEMORY_BYTES) {
      throw new RangeError(
        `required WASM memory (${byteLength} bytes) exceeds the ` +
          `${MAX_MEMORY_PAGES}-page (${MAX_MEMORY_MIB} MiB) limit; ` +
          `split the series into smaller chunks`,
      );
    }
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
    /**
     * Sums every value of a series using the WASM `sum` export.
     *
     * The series is written as little-endian f64 values starting at byte 0 of
     * this instance's memory before `sum(0, len)` is called. An empty series
     * returns `0` without producing a non-finite result.
     *
     * @param {Iterable<number>} values - Any iterable of finite numbers
     *   (arrays, generators, ...). The input is never mutated.
     * @returns {number} The total of all values as a JS number.
     * @throws {TypeError} If `values` is not iterable, or if any element is
     *   not a number or is non-finite (`NaN`, `Infinity`, `-Infinity`).
     * @throws {RangeError} If writing the series would exceed this module's
     *   16-page (1 MiB) WASM memory ceiling.
     */
    sum(values) {
      const series = toSeries(values);
      writeInput(series);
      return sum(INPUT_PTR, series.length);
    },

    /**
     * Computes sliding averages of a series using the WASM `moving_average`
     * export. Result `i` is the mean of `values[i] .. values[i + window - 1]`.
     *
     * Results are written after the input region (byte 1024 for up to 128 f64
     * values, otherwise immediately after the input) and copied into a fresh
     * array, so successive calls never return stale output.
     *
     * @param {Iterable<number>} values - Any iterable of finite numbers. The
     *   same validation as {@link Timeseries#sum} applies.
     * @param {number} window - Integer window width; widths below `1` or
     *   greater than the series length yield an empty result.
     * @returns {number[]} A fresh array of length
     *   `values.length - window + 1`, or `[]` for an empty series or an
     *   invalid-but-integer window. A window of `1` copies the input.
     * @throws {TypeError} If `values` is not iterable or contains a non-number
     *   or non-finite element, or if `window` is not an integer number
     *   (`NaN`, `Infinity`, `1.5`, `"2"`, ...).
     * @throws {RangeError} If the input or adaptive output region would
     *   exceed the 16-page (1 MiB) WASM memory ceiling.
     */
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
