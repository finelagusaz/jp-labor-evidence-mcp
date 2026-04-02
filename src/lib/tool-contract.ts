import { z } from 'zod';
import { AmbiguousInputError, ExternalApiError, NotFoundError, ParseError, ValidationError } from './errors.js';
import { observabilityRegistry } from './observability.js';
import type { PartialFailure, WarningMessage } from './types.js';

export const toolStatusSchema = z.enum(['ok', 'partial', 'not_found', 'unavailable', 'invalid']);
export const errorCodeSchema = z.enum([
  'validation',
  'not_found',
  'upstream_unavailable',
  'parse_error',
  'internal_error',
]);

export const warningSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const partialFailureSchema = z.object({
  source: z.string(),
  target: z.string(),
  reason: z.string(),
});

export type ToolStatus = z.infer<typeof toolStatusSchema>;
export type ToolErrorCode = z.infer<typeof errorCodeSchema>;
export type ToolEnvelope<T> = {
  status: ToolStatus;
  error_code?: ToolErrorCode;
  retryable?: boolean;
  degraded?: boolean;
  warnings: WarningMessage[];
  partial_failures: PartialFailure[];
  data: T | null;
};

export function createToolEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    status: toolStatusSchema,
    error_code: errorCodeSchema.optional(),
    retryable: z.boolean().optional(),
    degraded: z.boolean().optional(),
    warnings: z.array(warningSchema),
    partial_failures: z.array(partialFailureSchema),
    data: dataSchema.nullable(),
  });
}

export function createToolResult<T extends Record<string, unknown> | null>(
  toolName: string,
  envelope: ToolEnvelope<T>,
  text: string,
  startedAt?: number,
) {
  observabilityRegistry.recordToolCall(toolName, startedAt ? Date.now() - startedAt : 0, {
    isError: envelope.status === 'invalid' || envelope.status === 'unavailable',
    status: envelope.status,
  });
  return {
    structuredContent: envelope,
    content: [{ type: 'text' as const, text }],
    isError: envelope.status === 'invalid' || envelope.status === 'unavailable',
  };
}

export function mapErrorToEnvelope(error: unknown): ToolEnvelope<null> {
  if (error instanceof ValidationError || error instanceof AmbiguousInputError) {
    return {
      status: 'invalid',
      error_code: 'validation',
      retryable: false,
      degraded: false,
      warnings: [],
      partial_failures: [],
      data: null,
    };
  }

  if (error instanceof NotFoundError) {
    return {
      status: 'not_found',
      error_code: 'not_found',
      retryable: false,
      degraded: false,
      warnings: [],
      partial_failures: [],
      data: null,
    };
  }

  if (error instanceof ExternalApiError) {
    return {
      status: 'unavailable',
      error_code: 'upstream_unavailable',
      retryable: true,
      degraded: false,
      warnings: [],
      partial_failures: [],
      data: null,
    };
  }

  if (error instanceof ParseError) {
    return {
      status: 'unavailable',
      error_code: 'parse_error',
      retryable: false,
      degraded: true,
      warnings: [],
      partial_failures: [],
      data: null,
    };
  }

  return {
    status: 'unavailable',
    error_code: 'internal_error',
    retryable: false,
    degraded: false,
    warnings: [],
    partial_failures: [],
    data: null,
  };
}

export function isoNow(): string {
  return new Date().toISOString();
}
