import { readFile, writeFile } from "node:fs/promises";
import wabtFactory from "wabt";

const root = new URL(".", import.meta.url);
const sourcePath = new URL("wasm/timeseries.wat", root);
const binaryPath = new URL("wasm/timeseries.wasm", root);

const wabt = await wabtFactory();
const source = await readFile(sourcePath, "utf8");
const module = wabt.parseWat("timeseries.wat", source);
module.resolveNames();
module.validate();

const { buffer } = module.toBinary({ write_debug_names: true });
await writeFile(binaryPath, Buffer.from(buffer));
module.destroy();

console.log(`Wrote ${binaryPath.pathname} (${buffer.length} bytes)`);
