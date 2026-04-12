# ADR-002: Drizzle ORM

## Status
Accepted

## Context
The Java version uses a custom model layer (`javaxt.sql.Model`) with raw SQL queries. For the TypeScript conversion, we need an ORM or query builder.

Options considered:
1. **Drizzle ORM** — lightweight, SQL-like API, excellent TypeScript type inference
2. **Prisma** — schema-first with codegen, popular but heavier
3. **Knex** — query builder only, closest to raw SQL
4. **TypeORM / MikroORM** — traditional ORMs with decorators

## Decision
We will use **Drizzle ORM**.

## Rationale
- **SQL-like API** — Drizzle's query builder reads like SQL, making it easy to port the Java version's raw SQL queries
- **TypeScript-first** — schema definitions produce fully typed query results without codegen steps
- **Lightweight** — minimal runtime overhead compared to Prisma or TypeORM
- **Excellent SQLite support** — first-class `better-sqlite3` driver
- **Migration tooling** — `drizzle-kit` generates SQL migrations from schema changes
- **Raw SQL escape hatch** — for complex queries (spatial queries, CTEs), Drizzle supports raw SQL seamlessly
