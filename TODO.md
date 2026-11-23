# TODO — wasm-timeseries-feature-selection

Step-by-step plan for this repository. Unchecked `- [ ]` items are remaining
steps; checked `- [x]` items are done. Never delete this file. When a step is
finished, tick its checkbox and append newly discovered follow-up items.

## Roadmap

- [x] Add a WASM module with a time-series helper (sum / moving average).
- [x] Add a JS loader for the WASM module.
- [x] Add a feature-extraction function (mean, min, max, slope) over a series.
- [x] Add a simple feature-selection scorer ranking features by usefulness.
- [x] Add a test suite runnable with `node test.mjs`.
- [x] Document the API and the loop in README.md.

## Follow-ups discovered

- [x] Add a standalone manual verification path (`node verify.mjs`) that exercises the raw WASM `sum` and `moving_average` exports (step 1).
- [x] Verify the checked-in `wasm/timeseries.wasm` stays byte-identical after `npm run build` (guard against stale binaries).
- [x] Document the `wabt` dev dependency and the `npm run build` rebuild command in README.md when documenting the API (step 6).
- [x] Document the `loadTimeseries` loader API (including empty/invalid input behavior and the byte-1024 output layout) in README.md (step 6).
- [x] Document the loader's adaptive output pointer for series longer than 128 f64 values (input at byte 0, output after the input region) in README.md (step 6).
- [x] Document the async `extractFeatures` API (returns `{ mean, min, max, slope, variance, stddev }`; empty series yields all zeros, single-element series has zero slope/variance/stddev) in README.md (step 6).
- [x] Add population variance and standard deviation features on top of the WASM-backed sum; append `variance` then `stddev` to `CANONICAL_ORDER`; cover them in tests and README.md.
- [x] Document the synchronous `selectFeatures` scorer API in README.md (step 6): returns `{ name, value, score }` entries ranked by magnitude-normalized usefulness, canonical tie-break `[mean, min, max, slope, variance, stddev]`, zero-score behavior for all-zero/empty input, strict validation, and the `scoreFeatures` alias.
- [x] Decide whether unknown feature keys should be accepted or rejected by the scorer — decision: keep accepting them as an intentional, backwards-compatible extension point; formalize the policy in README.md and lock it in with tests.
- [x] Document the loader's automatic WASM memory growth behavior and its 16-page (1 MiB) ceiling in README.md (step 6).
- [x] Handle the loader's 16-page memory ceiling gracefully: reject oversized input/output regions with a descriptive `RangeError` before calling `memory.grow`, and document the error in README.md.
- [ ] Add JSDoc annotations to loader.mjs, features.mjs and select.mjs so reference docs can be generated automatically in a future step.
- [ ] Add a short end-to-end README example chaining loadTimeseries -> extractFeatures -> selectFeatures in a future step.
- [ ] Run `npm ci && npm run check:build` in a CI workflow so stale-binary drift fails on every push (the `node test.mjs` check skips when wabt is absent).
- [ ] Consider pinning `wabt` to an exact version so a dependency upgrade cannot cause a false stale-binary report.
- [ ] Consider adding a check that `npm run build` is idempotent (a second build leaves the binary unchanged).
- [ ] Consider a numerically stable (e.g. Welford) variance computation: the current mean-of-squared-deviations can overflow to `Infinity` for extremely large finite inputs, which would violate the all-finite guarantee.
- [ ] Consider clamping variance/stddev (or documenting an explicit limit) for series whose sum overflows the WASM f64 accumulator before division by `n`.
- [ ] Add variance/stddev to a short end-to-end README example chaining `extractFeatures -> selectFeatures` (alongside the existing loader example).
- [ ] Demonstrate a custom/unknown feature key in the end-to-end README example so the accepted-keys policy is shown, not just described.
- [ ] Consider extracting the scorer's three-tier tie comparison into a named, exported helper so consumers can reuse the exact canonical-then-alphabetical ordering.
- [ ] Consider a property-based test that generates arbitrary key sets (canonical + unknown, mixed magnitudes) and asserts the documented scoring/ordering invariants.
- [ ] Consider raising the WASM module's declared memory maximum (and the loader's named ceiling together) so series larger than 1 MiB can be processed.
- [ ] Consider adding a loader helper that automatically splits oversized series into chunks and concatenates the results instead of throwing.
- [ ] Add a boundary test proving a series whose input/output regions fit exactly at 16 pages still succeeds while one byte more is rejected.
