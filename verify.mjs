import { readFile } from "node:fs/promises";

const bytes = await readFile(new URL("./wasm/timeseries.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, {});
const { memory, sum, moving_average } = instance.exports;

const view = new DataView(memory.buffer);
const INPUT = 0;
const OUTPUT = 1024;

function write(values, ptr = INPUT) {
  values.forEach((value, i) => view.setFloat64(ptr + i * 8, value, true));
}

function read(count, ptr = OUTPUT) {
  return Array.from({ length: count }, (_, i) =>
    view.getFloat64(ptr + i * 8, true),
  );
}

const series = [1.5, 2.5, 3, -1];
write(series);
console.log(`sum([${series}]) = ${sum(INPUT, series.length)}`);
console.log(`sum(empty) = ${sum(INPUT, 0)}`);

const values = [1, 2, 3, 4];
write(values);
const count = moving_average(INPUT, values.length, 2, OUTPUT);
console.log(`moving_average([${values}], window=2) = [${read(count)}]`);

const invalid = moving_average(INPUT, values.length, 0, OUTPUT);
console.log(`moving_average(window=0) returned ${invalid} results`);
