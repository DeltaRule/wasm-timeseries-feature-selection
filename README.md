# wasm-timeseries-feature-selection
Self-improving WASM time-series feature selection project

## Step 1: time-series WASM module

`wasm/timeseries.wasm` is a dependency-free WebAssembly module (no host
imports) compiled from the checked-in `wasm/timeseries.wat` source.

```sh
npm install     # once: installs `wabt`, used only by the build
npm run build   # one-command reproducible build of the .wasm from the .wat
node test.mjs   # smoke-tests the checked-in binary; no dependencies needed
```

### Exports

| Export | Signature | Behavior |
| --- | --- | --- |
| `memory` | `WebAssembly.Memory` | 2 pages initial (128 KiB), 16 pages maximum. |
| `sum` | `(ptr: i32, len: i32) -> f64` | Total of `len` values from `ptr`; `0.0` when `len <= 0`. Writes no memory. |
| `moving_average` | `(ptr: i32, len: i32, window: i32, outPtr: i32) -> i32` | Writes `len - window + 1` sliding averages at `outPtr` and returns that count; returns `0` without writing when `window < 1` or `window > len`. |

### Memory / ABI convention

- Every number is an IEEE-754 **f64**, **8 bytes**, **little-endian**
  (`DataView#setFloat64(offset, value, true)`).
- `ptr` and `outPtr` are **byte offsets**, not array indices: element `i`
  is at `ptr + 8*i`, and result `i` is at `outPtr + 8*i`.
- `sum` returns its result as a scalar `f64` on the WASM stack and writes
  nothing to memory.
- `moving_average` computes result `i` as the mean of input values
  `i .. i+window-1`, for `i = 0 .. count-1` where `count = len - window + 1`.
  It writes those `count` f64 values starting at `outPtr` and returns `count`.
- Suggested layout for the upcoming JS loader (step 2): input at byte **0**,
  output at byte **1024** (128 f64 inputs fit before the output region).
  Keep the regions non-overlapping and reserve `count * 8` bytes for results.
  Other non-overlapping byte offsets work too, as shown in `test.mjs`.

Progress is tracked in [TODO.md](TODO.md).
