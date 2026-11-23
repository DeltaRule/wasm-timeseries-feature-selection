# TODO — wasm-timeseries-feature-selection

Step-by-step plan for this repository. Unchecked `- [ ]` items are remaining
steps; checked `- [x]` items are done. Never delete this file. When a step is
finished, tick its checkbox and append newly discovered follow-up items.

## Roadmap

- [x] Add a WASM module with a time-series helper (sum / moving average).
- [x] Add a JS loader for the WASM module.
- [x] Add a feature-extraction function (mean, min, max, slope) over a series.
- [x] Add a simple feature-selection scorer ranking features by usefulness.
- [ ] Add a test suite runnable with `node test.mjs`.
- [ ] Document the API and the loop in README.md.

## Follow-ups discovered

- [ ] Verify the checked-in `wasm/timeseries.wasm` stays byte-identical after `npm run build` (guard against stale binaries).
- [ ] Document the `wabt` dev dependency and the `npm run build` rebuild command in README.md when documenting the API (step 6).
- [ ] Document the `loadTimeseries` loader API (including empty/invalid input behavior and the byte-1024 output layout) in README.md (step 6).
- [ ] Document the loader's adaptive output pointer for series longer than 128 f64 values (input at byte 0, output after the input region) in README.md (step 6).
- [ ] Document the async `extractFeatures` API (returns `{ mean, min, max, slope }`; empty series yields all zeros, single-element series has zero slope) in README.md (step 6).
- [ ] Consider adding variance / standard deviation features on top of the WASM-backed sum in a future step.
- [ ] Document the synchronous `selectFeatures` scorer API in README.md (step 6): returns `{ name, value, score }` entries ranked by magnitude-normalized usefulness, canonical tie-break `[mean, min, max, slope]`, zero-score behavior for all-zero/empty input, strict validation, and the `scoreFeatures` alias.
- [ ] Decide in a later step whether unknown feature keys should be accepted or rejected by the scorer (currently scored after the canonical keys and sorted by name).
