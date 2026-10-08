/**
 * 共通エラークラス
 * REST API と MCP ツールの両方で使用
 */

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** 上流が 404 を返した（指定した資料が上流に存在しない） */
export class UpstreamNotFoundError extends NotFoundError {
  readonly httpStatus = 404;
  constructor(readonly url: string, statusText = 'Not Found') {
    super(`HTTP 404 ${statusText} — ${url}`);
    this.name = 'UpstreamNotFoundError';
  }
}

export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class UnsupportedError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedError';
  }
}

export class ExternalApiError extends Error {
  readonly status = 502;
  /** 時間をおいて再試行すれば成功しうるか（mapErrorToEnvelope の retryable） */
  readonly retryable: boolean;
  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ExternalApiError';
    this.retryable = options.retryable ?? true;
  }
}

/** 再試行すれば成功しうる HTTP の状態（5xx・429・408） */
export function isRetryableHttpStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

/** 上流が 404 以外の非 2xx を返した */
export class UpstreamHttpError extends ExternalApiError {
  constructor(readonly httpStatus: number, statusText: string, readonly url: string) {
    super(`HTTP ${httpStatus} ${statusText} — ${url}`, { retryable: isRetryableHttpStatus(httpStatus) });
    this.name = 'UpstreamHttpError';
  }
}

/** 上流がタイムアウトした */
export class UpstreamTimeoutError extends ExternalApiError {
  constructor(readonly url: string, timeoutMs: number) {
    super(`Timeout after ${timeoutMs}ms — ${url}`, { retryable: true });
    this.name = 'UpstreamTimeoutError';
  }
}

/** 上流の失敗が続いたため、サーキットブレーカーが要求を止めている */
export class CircuitOpenError extends ExternalApiError {
  constructor(baseUrl: string, readonly retryAt: string) {
    super(`Circuit breaker is open for ${baseUrl} until ${retryAt}`, { retryable: true });
    this.name = 'CircuitOpenError';
  }
}

export class ParseError extends Error {
  readonly status = 502;
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export class AmbiguousInputError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'AmbiguousInputError';
  }
}

/**
 * 部分失敗の reason。上流の失敗の種類を区別して、degrade の理由を正確に伝える
 */
export function failureReasonOf(error: unknown): string {
  if (error instanceof NotFoundError) return 'not_found';
  if (error instanceof CircuitOpenError) return 'circuit_open';
  if (error instanceof UpstreamTimeoutError) return 'timeout';
  if (error instanceof ExternalApiError) return 'upstream_unavailable';
  if (error instanceof ParseError) return 'parse_error';
  if (error instanceof Error) return error.name;
  return 'unknown_error';
}

