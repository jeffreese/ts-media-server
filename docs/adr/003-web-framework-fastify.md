# ADR-003: Fastify as the Web Framework

## Status
Accepted

## Context
The Java version uses an embedded HTTP server (`javaxt.http.Server`) with a custom servlet for request routing, static file serving, and WebSocket support. We need a Node.js web framework.

Options considered:
1. **Fastify** — high performance, plugin ecosystem, TypeScript support, built-in validation
2. **Express** — most popular, large ecosystem, but aging API
3. **Hono** — ultrafast, lightweight, modern
4. **Koa** — minimal, middleware-focused

## Decision
We will use **Fastify** with `@fastify/websocket` for WebSocket support.

## Rationale
- **Performance** — Fastify is one of the fastest Node.js frameworks, important for a media server handling image/video requests
- **Built-in WebSocket** — `@fastify/websocket` integrates natively, avoiding a separate WebSocket server. The Java version's WebSocket broadcasting maps directly to this.
- **Plugin architecture** — `@fastify/static` for web directory serving, `@fastify/cors` for CORS, `@fastify/jwt` for authentication — all official, well-maintained plugins
- **pino logging built-in** — Fastify uses pino internally, giving us structured request logging for free
- **Schema validation** — Fastify's built-in JSON Schema validation pairs well with our Zod config validation
- **TypeScript support** — strong type inference for routes, request/response
