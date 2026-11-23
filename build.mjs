import { readFile, writeFile } from "node:fs/promises";
import wabtFactory from "wabt";
import { compileTimeseries } from "./wasm-compile.mjs";

const root = new URL(".", import.meta.url);
const sourcePath = new URL("wasm/timeseries.wat", root);
const binaryPath = new URL("wasm/timeseries.wasm", root);

const wabt = await wabtFactory();
const source = await readFile(sourcePath, "utf8");
const binary = compileTimeseries(wabt, source);
await writeFile(binaryPath, binary);

console.log(`Wrote ${binaryPath.pathname} (${binary.length} bytes)`);
