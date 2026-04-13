# ADR-016: Config File + Environment Variables with Zod Validation

## Status
Accepted

## Context
The Java version uses a `config.json` file with relative path resolution and persists some settings to the database. We need a configuration strategy for the Node conversion.

Options considered:
1. **config.json only** — matches the Java version
2. **Environment variables only** — 12-factor style
3. **Both** — config file for complex settings, env vars for deployment overrides

## Decision
We will use **config.json for complex/nested settings** combined with **environment variable overrides for deployment settings**, validated at startup with **Zod**.

## Rationale

### Dual source
- **config.json** is natural for nested configuration (thumbnail sizes, model paths, database options). Matches the Java version's approach.
- **Environment variables** are the standard mechanism for deployment-specific overrides (port, database path, log level). Essential for containerized deployments.
- **Precedence:** env vars > config.json > defaults

### Zod validation
- **Type safety** — Zod schemas produce TypeScript types, so config values are fully typed throughout the application
- **Fail fast** — invalid config is caught at startup with clear error messages, not at runtime when a bad value is first used
- **Documentation** — the Zod schema serves as living documentation of all config options, their types, and defaults
- **Pairs with Drizzle** — Zod is already common in the Drizzle ecosystem for validation

## Config Structure
```typescript
const configSchema = z.object({
  port: z.number().default(8080),
  webDir: z.string().optional(),
  logDir: z.string().optional(),
  temp: z.string().optional(),
  database: z.object({
    path: z.string().default("data/database.sqlite"),
  }),
  thumbnails: z.object({
    sizes: z.array(z.string()).default(["1920x1080", "1280x720", "640x480", "300x300", "150x100"]),
  }),
  concurrency: z.number().default(Math.max(Math.floor(availableParallelism() / 2), 2)),
  sharpConcurrency: z.number().default(Math.min(availableParallelism(), 4)),
  jwt: z.object({
    secret: z.string(),
    expiresIn: z.string().default("24h"),
  }),
});
```

The `concurrency` value controls how many files are processed in parallel via `p-limit` (see ADR-010). The default halves the CPU count to leave headroom for native thread pools in sharp and onnxruntime. `sharpConcurrency` controls the sharp/libvips thread pool size and is applied at startup via `sharp.concurrency()`.

## Database-Persisted Settings
Runtime-configurable values stored in the `setting` table (matching Java behavior):
- FFmpeg path
- ONNX model paths (face detection, facial recognition)
- Auth status (enabled/disabled)
