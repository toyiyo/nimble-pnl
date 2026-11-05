# Vite 8 upgrade fixes: plan

Design: `docs/superpowers/specs/2026-11-03-vite8-upgrade-fixes-design.md`

1. Run `tests/e2e/time-punch-upload.spec.ts` and check that it fails.
2. Change `manualChunks` in `vite.config.ts` to a function.
3. Match the `mermaid` entry module only.
4. Change the test selector to the visible text.
5. Run the build, the E2E test, typecheck, lint, and unit tests.
6. Compare the startup JavaScript size to the Vite 5 build.
