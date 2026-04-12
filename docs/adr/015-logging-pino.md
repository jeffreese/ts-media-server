# ADR-015: pino for Logging

## Status
Accepted

## Context
The Java version has basic console logging and a web request logger that writes to a configurable log directory. We need a logging solution for the Node conversion.

Options considered:
1. **pino** — fast, JSON-structured, built into Fastify
2. **winston** — feature-rich, multiple transports, but heavier
3. **console** — no dependency, but no structure or log levels

## Decision
We will use **pino**, which comes built into Fastify.

## Rationale
- **Zero additional dependency** — Fastify uses pino internally. `fastify.log` is available on every request without installing anything extra.
- **Structured JSON logging** — machine-parseable log output, useful for log aggregation and search
- **High performance** — pino is the fastest Node.js logger, designed to minimize overhead on the hot path
- **Request logging for free** — Fastify automatically logs every HTTP request with method, URL, status code, and response time
- **Log levels** — `trace`, `debug`, `info`, `warn`, `error`, `fatal` — configurable per environment
- **File transport** — `pino-file` or `pino.destination()` for writing to the configurable log directory, matching the Java version's behavior
