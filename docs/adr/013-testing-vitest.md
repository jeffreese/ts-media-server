# ADR-013: Vitest for Testing

## Status
Accepted

## Context
The Java version has no automated tests. The Node conversion is an opportunity to establish a testing practice from the start.

Options considered:
1. **Vitest** — fast, native TypeScript/ESM, Jest-compatible API
2. **Jest** — most popular, mature, but slower and needs config for TypeScript/ESM
3. **Node's built-in test runner** — minimal, no extra deps, fewer features

## Decision
We will use **Vitest** for unit and integration tests.

## Rationale
- **Native ESM support** — our project is pure ESM; Vitest handles this without configuration. Jest requires additional setup for ESM.
- **TypeScript-first** — runs TypeScript directly without a separate compile step
- **Fast** — uses Vite's transform pipeline, significantly faster than Jest for TypeScript projects
- **Jest-compatible API** — familiar `describe`, `it`, `expect` patterns; easy for anyone to pick up
- **Built-in mocking** — `vi.mock()`, `vi.spyOn()` for isolating units under test

## Scope
Starting with unit and integration tests:
- **Unit tests** — services (phash, metadata extraction, thumbnail generation), utilities (FFmpeg wrapper, config validation)
- **Integration tests** — Fastify route handlers with in-memory SQLite database, testing request/response cycles

End-to-end API tests may be added in a future phase.
