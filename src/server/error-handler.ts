import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod/v4';

/**
 * JSON body sent on failed requests after the global error handler runs.
 * `error` is a short HTTP-style label (e.g. `"Bad Request"`), `message` is
 * the specific reason, and `details` is present only when extra structure is
 * safe to expose (notably Zod validation issue lists).
 */
export interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}

function isZodError(err: unknown): err is z.ZodError {
  return err instanceof z.ZodError;
}

function isFastifyError(err: unknown): err is FastifyError {
  return typeof err === 'object' && err !== null && 'statusCode' in err;
}

function buildResponse(statusCode: number, message: string, details?: unknown): ErrorResponse {
  const labels: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    408: 'Request Timeout',
    413: 'Payload Too Large',
    415: 'Unsupported Media Type',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    503: 'Service Unavailable',
  };

  const response: ErrorResponse = {
    statusCode,
    error: labels[statusCode] ?? 'Error',
    message,
  };

  if (details !== undefined) {
    response.details = details;
  }

  return response;
}

/**
 * Global Fastify error handler that normalises all thrown errors into a
 * consistent JSON shape: `{ statusCode, error, message, details? }`.
 *
 * Special handling for:
 * - **Zod validation errors** → 400 with field-level `details`
 * - **Fastify built-in errors** (content-type, payload, schema) → preserve
 *   original status code
 * - **Unhandled / unknown errors** → 500 with generic message (details
 *   are logged but never leaked to the client)
 */
export const errorHandlerPlugin = fp(
  async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
    app.setErrorHandler(function globalErrorHandler(
      err: Error,
      request: FastifyRequest,
      reply: FastifyReply,
    ) {
      if (isZodError(err)) {
        const details = err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        }));

        const body = buildResponse(400, 'Validation failed', details);
        return reply.code(400).send(body);
      }

      if (isFastifyError(err)) {
        const code = err.statusCode ?? 500;
        const body = buildResponse(code, err.message);

        if (code >= 500) {
          request.log.error({ err }, err.message);
        }

        return reply.code(code).send(body);
      }

      request.log.error({ err }, err.message || 'Unhandled error');

      const body = buildResponse(500, 'Internal server error');
      return reply.code(500).send(body);
    });
  },
  { name: 'error-handler' },
);
