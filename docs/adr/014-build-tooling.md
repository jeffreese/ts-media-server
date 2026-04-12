# ADR-014: pnpm + tsx + tsup Build Tooling

## Status
Accepted

## Context
We need to choose a package manager, development runner, and production build tool for the TypeScript project.

## Decision

### Package Manager: pnpm
### Development: tsx (run TypeScript directly)
### Production Build: tsup (compile to JavaScript)
### Module System: Pure ESM

## Rationale

### pnpm
- **Faster installs** than npm due to content-addressable storage and hard links
- **Disk efficient** — shared dependency store across projects
- **Strict dependency resolution** — prevents phantom dependencies (accessing packages not declared in `package.json`)
- **pnpm workspaces** available if we ever split into a monorepo (not planned, but no lock-in)

### tsx (development)
- **Zero config** — runs TypeScript files directly without a compile step
- **Fast** — built on esbuild for near-instant transforms
- **Watch mode** — `tsx watch src/index.ts` for development with auto-restart
- **ESM support** — handles pure ESM projects natively

### tsup (production)
- **Simple config** — minimal `tsup.config.ts` for building the project
- **Built on esbuild** — fast compilation
- **Bundles to dist/** — single or few output files for production deployment
- **Declaration files** — can generate `.d.ts` if needed
- **Tree shaking** — eliminates dead code in production builds

### Pure ESM
- **Modern standard** — ESM is the direction of the Node.js ecosystem
- **All chosen dependencies support ESM** — Fastify, Drizzle, sharp, Commander.js, etc.
- **Top-level await** — useful for initialization (database setup, config loading)
- **Better static analysis** — enables tree shaking in tsup builds
