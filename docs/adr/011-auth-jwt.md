# ADR-011: JWT Authentication (Replacing Basic Auth)

## Status
Accepted

## Context
The Java version uses HTTP Basic Authentication with BCrypt password hashing. Credentials are sent with every request (base64-encoded username:password).

Options considered:
1. **HTTP Basic Auth + BCrypt** — matches the Java version
2. **JWT (JSON Web Tokens)** — stateless token-based auth
3. **Session-based (cookies)** — traditional server-side sessions

## Decision
We will use **JWT** for authentication, with **BCrypt** retained for password storage. A "disabled auth" mode will be preserved for fresh installs.

## Rationale
- **Better for SPAs** — the web app frontend can store the JWT and include it in API requests without re-sending credentials on every call
- **Stateless** — no server-side session storage needed. The token contains the user identity and can be verified without a database lookup on every request.
- **WebSocket friendly** — JWT can be sent during the WebSocket handshake, cleaner than Basic Auth for persistent connections
- **Modern standard** — widely understood, well-tooled (`@fastify/jwt` integrates natively with Fastify)

## Implementation
- `POST /auth/login` — accepts username/password, returns JWT
- JWT contains user ID and expiration
- BCrypt (cost factor 12) for password hashing in `user_authentication` table
- `@fastify/jwt` decorates Fastify requests with `request.jwtVerify()`
- Fastify `preHandler` hook checks for valid JWT on protected routes (`onRequest` fires before body parsing; `preHandler` is the correct lifecycle point for auth checks that need to coexist with body-dependent routes)
- Disabled auth mode: when `auth_status` setting is "disabled", all requests are treated as the default admin user (matching Java behavior for fresh installs)

## Tradeoffs
- **Token expiration** — JWTs require expiration management. We'll use configurable expiration (default: 24 hours) with the option for the client to refresh.
- **No immediate revocation** — unlike session-based auth, a JWT can't be invalidated server-side without a blocklist. Acceptable for a self-hosted media server with a small user base.
