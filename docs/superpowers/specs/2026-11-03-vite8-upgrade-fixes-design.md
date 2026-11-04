# Vite 8 upgrade fixes (PR 721)

## Problem

Dependabot PR 721 changes `vite` from `^5.4.21` to `^8.2.1` and `lovable-tagger` from `^1.1.9` to `^1.3.3`.
Two failures occur:

1. The production build stops with `TypeError: manualChunks is not a function`.
   Vite 8 bundles with Rolldown. Rolldown accepts `manualChunks` only as a function.
2. `tests/e2e/time-punch-upload.spec.ts` times out.
   The test selects `div[data-component-name="Badge"]`.
   `lovable-tagger` 1.3.3 adds that attribute only when `LOVABLE_DEV_SERVER=true`.

## Design

- Move the chunk groups to the `VENDOR_CHUNKS` constant in `vite.config.ts`.
- Change `manualChunks` to a function that matches each module path against `VENDOR_CHUNKS`.
- Match the `mermaid` entry module only. A match on the full package puts the lazy diagram modules in the startup chunk.
- Change the test to find the visible text `Imported`.

## Alternatives

- Keep Vite 5. This stops the upgrade, so we do not use it.
- Set `LOVABLE_DEV_SERVER=true` in CI. This keeps a test dependency on a dev-only attribute, so we do not use it.

## Size check

| Build | JavaScript at startup | JavaScript files |
|---|---|---|
| Vite 5 | 7.39 MB | 65 |
| Vite 8, full `mermaid` match | 9.88 MB | 41 |
| Vite 8, `mermaid` entry match | 7.54 MB | 100 |
