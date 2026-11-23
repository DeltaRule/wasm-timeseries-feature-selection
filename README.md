# wasm-timeseries-feature-selection
Self-improving WASM time-series feature selection project

## Step 1: time-series WASM module

`wasm/timeseries.wasm` is a dependency-free WebAssembly module (no host
imports) compiled from the checked-in `wasm/timeseries.wat` source.

```sh
npm install         # once: installs `wabt`, used only by build/check
npm run build       # one-command reproducible build of the .wasm from the .wat
npm run check:build # fail if the checked-in .wasm is stale vs the .wat
node test.mjs       # smoke-tests the checked-in binary; no dependencies needed
npm run verify      # manual check of the raw sum / moving_average exports
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
- Suggested layout for the JS loader (`loadTimeseries`, documented below):
  input at byte **0**, output at byte **1024** (128 f64 inputs fit before the output region).
  Keep the regions non-overlapping and reserve `count * 8` bytes for results.
  Other non-overlapping byte offsets work too, as shown in `test.mjs`.

Progress is tracked in [TODO.md](TODO.md).

## Build and development

- `wabt` (WebAssembly Binary Toolkit) is the project's only dependency and is
  declared under `devDependencies`. It is used solely by `build.mjs`; nothing
  at runtime needs it, and `node test.mjs` runs against the checked-in `.wasm`
  binary with no install at all.
- `npm install` installs the version of `wabt` pinned by `package-lock.json`.
- `npm run build` is the one-command, reproducible rebuild: it runs
  `node build.mjs`, which parses and validates `wasm/timeseries.wat` and writes
  `wasm/timeseries.wasm`. Run it after every edit to the `.wat` source and
   commit the regenerated binary alongside the source. `npm run build` and
   `npm test` are thin aliases for `node build.mjs` and `node test.mjs`.
- `npm run check:build` is a thin alias for `node check-build.mjs`, the
  stale-binary guard described below.

### Stale-binary guard

`npm run check:build` regenerates `wasm/timeseries.wasm` in memory from
`wasm/timeseries.wat` using the exact same compiler options as `npm run build`
(both call `compileTimeseries` in `wasm-compile.mjs`) and compares the result
byte-for-byte with the checked-in file. A stale binary makes the command exit
non-zero with a message naming both byte counts and the first differing byte,
plus a reminder to run `npm run build`. The check reports drift without overwriting
the checked-in artifact: only `npm run build` writes the file.

The same check runs at the start of `node test.mjs` when `wabt` is installed, so
`npm test` fails loudly on drift too. To preserve the no-install guarantee, the
check skips gracefully with `wabt is not installed` when the dependency is
missing; the rest of the suite still runs and passes. Use
`npm run check:build` in CI after `npm ci` to make drift an unconditional
failure. `test.mjs` also exercises the guard with matching bytes and a
simulated stale binary in a temporary directory, asserting that the mismatch is
reported and the file is left untouched.

## API

The three JS modules are pure ESM (`"type": "module"` in `package.json`) and
can be imported by path. The loader is the only layer that touches WASM
directly; feature extraction builds on the loader, and scoring is pure JS.

### `loadTimeseries()` — async loader (`loader.mjs`)

```js
import { loadTimeseries } from "./loader.mjs";

const ts = await loadTimeseries();
ts.sum([1, 2, 3]);                    // 6
ts.movingAverage([1, 2, 3, 4], 2);    // [1.5, 2.5, 3.5]
```

`loadTimeseries()` reads `wasm/timeseries.wasm` relative to its own module file
(so it works from any working directory) and resolves to a fresh instance with
its own WASM linear memory. Calling it twice yields two independent instances
that do not share state. It is asynchronous because loading and instantiating
the binary is asynchronous; the two methods it returns are synchronous.

#### `sum(values)`

- Returns the total of every value as a JS number (a scalar WASM `f64` result).
- `values` may be any iterable of finite numbers (arrays, generators, ...).
- An empty iterable returns `0`.
- Non-iterables (`null`, `undefined`, plain objects, strings, ...), non-number
  elements, and non-finite elements (`NaN`, `Infinity`, `-Infinity`) throw a
  `TypeError` before any WASM call is made.
- Internally the series is written as little-endian f64 values starting at
  input byte `0`, then the WASM `sum(0, len)` export is called.

#### `movingAverage(values, window)`

- Returns a JS array of sliding averages with length
  `values.length - window + 1`; element `i` is the mean of input values
  `i .. i+window-1`.
- `window` must be an integer number. A non-integer or non-number window
  (`NaN`, `Infinity`, `1.5`, `"2"`, `null`, ...) throws a `TypeError`.
- The same `TypeError` validation as `sum` applies to `values`.
- An empty series, a window `< 1`, or a window greater than the series length
  returns `[]` without writing to WASM memory. A window of `1` returns a copy
  of the input (the identity transform).
- Output is never stale: after an empty/invalid call the next valid call
  writes and returns fresh values.

#### Memory layout, adaptive output pointer, and growth

- Input is always written at byte offset **0**, so element `i` lives at byte
  `8 * i`.
- Results are written at byte offset **1024** by default, leaving room for up
  to 128 f64 input values before the output region. The two regions never
  overlap and `count * 8` bytes are reserved for output.
- For series longer than 128 f64 values the output pointer becomes
  `max(1024, values.length * 8)`, i.e. it is placed immediately **after** the
  whole input region. This adaptive pointer keeps input and output
  non-overlapping for arbitrarily long series while preserving the byte-1024
  layout for short ones.
- Before each write, capacity is checked and WASM memory is grown with
  `memory.grow()` in 64 KiB pages whenever needed, so long series are handled
  automatically. The WASM module declares a maximum of **16 pages (1 MiB)**;
  a series that would push memory past that ceiling causes `memory.grow()` to
  throw a raw `RangeError`.

### `extractFeatures(values)` — async feature extraction (`features.mjs`)

```js
import { extractFeatures } from "./features.mjs";

await extractFeatures([1, 2, 3, 4]);
// { mean: 2.5, min: 1, max: 4, slope: 1 }
```

- Returns a promise resolving to `{ mean, min, max, slope }`, all finite JS
  numbers.
- `mean` is the WASM-backed `sum` of the series divided by its length; `min`
  and `max` come from a single scan; `slope` is the ordinary least-squares
  slope of the values against their zero-based index (the linear trend).
- An empty series yields `{ mean: 0, min: 0, max: 0, slope: 0 }`.
- A single-element series has `slope: 0` (and `mean === min === max`); a
  constant series also has `slope: 0`.
- Any iterable is accepted, including one-shot generators, and the input is
  never mutated. Non-iterables, non-number elements, and non-finite elements
  reject with a `TypeError`.
- The loader promise is cached at module scope, so repeated calls reuse one
  WASM instance.

### `selectFeatures(features)` / `scoreFeatures` — sync scorer (`select.mjs`)

```js
import { selectFeatures, scoreFeatures, CANONICAL_ORDER } from "./select.mjs";

scoreFeatures === selectFeatures; // true — scoreFeatures is an alias
selectFeatures({ mean: 2.5, min: 1, max: 4, slope: 1 });
// [
//   { name: "max",   value: 4,   score: 4 / 8.5 },
//   { name: "mean",  value: 2.5, score: 2.5 / 8.5 },
//   { name: "min",   value: 1,   score: 1 / 8.5 },
//   { name: "slope", value: 1,   score: 1 / 8.5 },
// ]
```

- `features` is a plain object mapping a feature name to a finite number.
  `null`, arrays, non-objects, and any non-number or non-finite value throw a
  `TypeError`.
- Returns a **fresh array** (fully synchronous, with no promise) of
  `{ name, value, score }` entries. The input object is never mutated, even
  when it is frozen.
- Usefulness is magnitude-normalized: each weight is `|value| / max(|values|)`
  and each score is `weight / sum(weights)`. Scores therefore lie in `[0, 1]`
  and sum to `1` for any non-zero input (up to floating-point rounding).
- Entries are sorted by descending score. Ties are broken by the canonical
  order `CANONICAL_ORDER = ["mean", "min", "max", "slope"]`, exported from
  `select.mjs`. Extra/unknown keys are accepted and scored too; on ties they
  come after the canonical keys and are then ordered deterministically by
  name (alphabetically).
- All-zero features yield every score `0` in canonical order, and an empty
  object yields `[]`. A total of `0` in the all-zero case is intentional:
  there is no magnitude to normalize.

## The self-improvement loop

The repository improves itself one roadmap step at a time, fully automated.
[TODO.md](TODO.md) is the single source of truth: unchecked `- [ ]` items are
remaining steps, checked `- [x]` items are done, and the file is never deleted.
Each cycle runs these roles in order:

1. **PM** reads `TODO.md`, `README.md`, and the code, then emits a JSON array
   containing **exactly one** ticket for the **first unchecked** item, with a
   clear title, detailed description, and acceptance criteria. If no items are
   unchecked and the test suite passes, PM emits `[]` and creates no tickets —
   the work is finished.
2. **Developer** implements only that one ticket, ticks its checkbox in
   `TODO.md`, appends any newly discovered follow-up items, adds or updates
   tests, runs `node test.mjs`, and commits and pushes directly to `main`. No
   pull requests are opened and no human input is waited on.
3. **Reviewer** verifies the ticket's changes and the test result before
   approving.

The loop then repeats with the next unchecked item. New work discovered along
the way is appended to the "Follow-ups discovered" section of `TODO.md`
instead of being dropped, so nothing is lost between cycles.
