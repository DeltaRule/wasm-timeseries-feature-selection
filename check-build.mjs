import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileTimeseries } from "./wasm-compile.mjs";

const root = new URL(".", import.meta.url);
export const SOURCE_PATH = new URL("wasm/timeseries.wat", root);
export const BINARY_PATH = new URL("wasm/timeseries.wasm", root);

const SKIP_REASON =
  "wabt is not installed; run npm install to enable the WASM build check";

export async function loadWabt() {
  try {
    const { default: wabtFactory } = await import("wabt");
    return await wabtFactory();
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return null;
    throw error;
  }
}

export function firstDifference(actual, expected) {
  const length = Math.min(actual.length, expected.length);
  for (let i = 0; i < length; i += 1) {
    if (actual[i] !== expected[i]) return i;
  }
  return actual.length === expected.length ? -1 : length;
}

export async function checkWasmBuild(options = {}) {
  const {
    wabt,
    sourcePath = SOURCE_PATH,
    binaryPath = BINARY_PATH,
  } = options;
  const compiler = wabt === undefined ? await loadWabt() : wabt;
  if (compiler === null) return { status: "skipped", reason: SKIP_REASON };

  const source = await readFile(sourcePath, "utf8");
  const expected = compileTimeseries(compiler, source);
  const actual = await readFile(binaryPath);

  if (!actual.equals(expected)) {
    const offset = firstDifference(actual, expected);
    throw new Error(
      `Checked-in ${binaryPath.pathname} is stale: the .wat source regenerates ` +
        `${expected.length} bytes but the file has ${actual.length} bytes ` +
        `(first difference at byte ${offset}). Run "npm run build" and commit ` +
        `the regenerated binary. The checked-in file was not modified.`,
    );
  }

  return { status: "ok", bytes: actual.length };
}

function isMainModule() {
  try {
    return (
      process.argv[1] !== undefined &&
      realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    const result = await checkWasmBuild();
    if (result.status === "skipped") {
      console.log(`SKIP: ${result.reason}`);
    } else {
      console.log(
        `OK: checked-in WASM matches the .wat source (${result.bytes} bytes)`,
      );
    }
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
