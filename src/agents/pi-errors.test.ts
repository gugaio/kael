import { describe, it, expect } from 'vitest';
import {
  PiEngineError,
  normalizePiError,
  classifyHttpError,
  shouldFallbackOnPiError,
} from './pi-errors.js';

describe('normalizePiError', () => {
  it('deve retornar PiEngineError inalterado', () => {
    const original = new PiEngineError({
      message: 'original error',
      code: 'timeout',
      retryable: true,
    });
    const normalized = normalizePiError(original);
    expect(normalized).toBe(original);
    expect(normalized.message).toBe('original error');
    expect(normalized.code).toBe('timeout');
    expect(normalized.retryable).toBe(true);
  });

  it('deve classificar AbortError como timeout', () => {
    const error = new DOMException('Aborted', 'AbortError');
    const normalized = normalizePiError(error);
    expect(normalized).toBeInstanceOf(PiEngineError);
    expect(normalized.code).toBe('timeout');
    expect(normalized.retryable).toBe(true);
    expect(normalized.message).toBe('Pi engine request timed out');
  });

  it('deve classificar TypeError como network', () => {
    const error = new TypeError('Network error');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('network');
    expect(normalized.retryable).toBe(true);
    expect(normalized.message).toBe('Pi engine network error: Network error');
  });

  it('deve classificar "rate limit" como rate_limit', () => {
    const error = new Error('rate limit exceeded');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('rate_limit');
    expect(normalized.retryable).toBe(true);
    expect(normalized.message).toBe('rate limit exceeded');
  });

  it('deve classificar "429" como rate_limit', () => {
    const error = new Error('HTTP 429');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('rate_limit');
    expect(normalized.retryable).toBe(true);
  });

  it('deve classificar "timeout" como timeout', () => {
    const error = new Error('request timed out');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('timeout');
    expect(normalized.retryable).toBe(true);
  });

  it('deve classificar "timed out" como timeout', () => {
    const error = new Error('connection timed out');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('timeout');
    expect(normalized.retryable).toBe(true);
  });

  it('deve classificar "request ended without sending any chunks" como timeout', () => {
    const error = new Error('request ended without sending any chunks');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('timeout');
    expect(normalized.retryable).toBe(true);
  });

  it('deve classificar "unauthorized" como auth (não retryable)', () => {
    const error = new Error('unauthorized access');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('auth');
    expect(normalized.retryable).toBe(false);
  });

  it('deve classificar "authentication" como auth (não retryable)', () => {
    const error = new Error('authentication failed');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('auth');
    expect(normalized.retryable).toBe(false);
  });

  it('deve classificar "invalid api key" como auth (não retryable)', () => {
    const error = new Error('invalid api key');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('auth');
    expect(normalized.retryable).toBe(false);
  });

  it('deve classificar "401" como auth (não retryable)', () => {
    const error = new Error('HTTP 401 unauthorized');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('auth');
    expect(normalized.retryable).toBe(false);
  });

  it('deve classificar "403" como auth (não retryable)', () => {
    const error = new Error('HTTP 403 forbidden');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('auth');
    expect(normalized.retryable).toBe(false);
  });

  it('deve classificar "network" como network', () => {
    const error = new Error('network error');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('network');
    expect(normalized.retryable).toBe(true);
  });

  it('deve classificar "econn" como network', () => {
    const error = new Error('econnrefused');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('network');
    expect(normalized.retryable).toBe(true);
  });

  it('deve classificar "fetch" como network', () => {
    const error = new Error('fetch failed');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('network');
    expect(normalized.retryable).toBe(true);
  });

  it('deve classificar "unavailable" como provider_unavailable', () => {
    const error = new Error('service unavailable');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('provider_unavailable');
    expect(normalized.retryable).toBe(true);
  });

  it('deve classificar "overloaded" como provider_unavailable', () => {
    const error = new Error('server overloaded');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('provider_unavailable');
    expect(normalized.retryable).toBe(true);
  });

  it('deve classificar "503" como provider_unavailable', () => {
    const error = new Error('HTTP 503');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('provider_unavailable');
    expect(normalized.retryable).toBe(true);
  });

  it('deve classificar "502" como provider_unavailable', () => {
    const error = new Error('HTTP 502 bad gateway');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('provider_unavailable');
    expect(normalized.retryable).toBe(true);
  });

  it('deve classificar erro desconhecido como unknown (não retryable)', () => {
    const error = new Error('random error');
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('unknown');
    expect(normalized.retryable).toBe(false);
  });

  it('deve classificar erro genérico como unknown (não retryable)', () => {
    const error = 'string error';
    const normalized = normalizePiError(error);
    expect(normalized.code).toBe('unknown');
    expect(normalized.retryable).toBe(false);
    expect(normalized.message).toBe('Pi engine unknown error');
  });
});

describe('classifyHttpError', () => {
  it('deve classificar 401 como auth', () => {
    const error = classifyHttpError(401, 'Invalid token');
    expect(error.code).toBe('auth');
    expect(error.statusCode).toBe(401);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('Pi engine auth error: Invalid token');
  });

  it('deve classificar 403 como auth', () => {
    const error = classifyHttpError(403, 'Forbidden');
    expect(error.code).toBe('auth');
    expect(error.statusCode).toBe(403);
    expect(error.retryable).toBe(false);
  });

  it('deve classificar 429 como rate_limit', () => {
    const error = classifyHttpError(429, 'Too many requests');
    expect(error.code).toBe('rate_limit');
    expect(error.statusCode).toBe(429);
    expect(error.retryable).toBe(true);
  });

  it('deve classificar 500 como provider_unavailable', () => {
    const error = classifyHttpError(500, 'Internal server error');
    expect(error.code).toBe('provider_unavailable');
    expect(error.statusCode).toBe(500);
    expect(error.retryable).toBe(true);
  });

  it('deve classificar 502 como provider_unavailable', () => {
    const error = classifyHttpError(502, 'Bad gateway');
    expect(error.code).toBe('provider_unavailable');
    expect(error.statusCode).toBe(502);
    expect(error.retryable).toBe(true);
  });

  it('deve classificar 503 como provider_unavailable', () => {
    const error = classifyHttpError(503, 'Service unavailable');
    expect(error.code).toBe('provider_unavailable');
    expect(error.statusCode).toBe(503);
    expect(error.retryable).toBe(true);
  });

  it('deve classificar 504 como provider_unavailable', () => {
    const error = classifyHttpError(504, 'Gateway timeout');
    expect(error.code).toBe('provider_unavailable');
    expect(error.statusCode).toBe(504);
    expect(error.retryable).toBe(true);
  });

  it('deve classificar 599 como provider_unavailable', () => {
    const error = classifyHttpError(599, 'Unknown error');
    expect(error.code).toBe('provider_unavailable');
    expect(error.statusCode).toBe(599);
    expect(error.retryable).toBe(true);
  });

  it('deve classificar 400 como unknown', () => {
    const error = classifyHttpError(400, 'Bad request');
    expect(error.code).toBe('unknown');
    expect(error.statusCode).toBe(400);
    expect(error.retryable).toBe(false);
  });

  it('deve classificar 404 como unknown', () => {
    const error = classifyHttpError(404, 'Not found');
    expect(error.code).toBe('unknown');
    expect(error.statusCode).toBe(404);
    expect(error.retryable).toBe(false);
  });

  it('deve classificar 200 como unknown', () => {
    const error = classifyHttpError(200, 'OK');
    expect(error.code).toBe('unknown');
    expect(error.statusCode).toBe(200);
    expect(error.retryable).toBe(false);
  });
});

describe('shouldFallbackOnPiError', () => {
  it('deve retornar false para timeout', () => {
    const error = new PiEngineError({
      message: 'timeout',
      code: 'timeout',
      retryable: true,
    });
    expect(shouldFallbackOnPiError(error)).toBe(false);
  });

  it('deve retornar true para rate_limit', () => {
    const error = new PiEngineError({
      message: 'rate limit',
      code: 'rate_limit',
      retryable: true,
    });
    expect(shouldFallbackOnPiError(error)).toBe(true);
  });

  it('deve retornar true para provider_unavailable', () => {
    const error = new PiEngineError({
      message: 'unavailable',
      code: 'provider_unavailable',
      retryable: true,
    });
    expect(shouldFallbackOnPiError(error)).toBe(true);
  });

  it('nao deve esconder configuracao invalida de provider/modelo', () => {
    const error = new PiEngineError({
      message: 'Model not found for provider=openai model=gpt-5.5',
      code: 'provider_unavailable',
      retryable: false,
    });
    expect(shouldFallbackOnPiError(error)).toBe(false);
  });

  it('deve retornar true para network', () => {
    const error = new PiEngineError({
      message: 'network',
      code: 'network',
      retryable: true,
    });
    expect(shouldFallbackOnPiError(error)).toBe(true);
  });

  it('deve retornar false para auth', () => {
    const error = new PiEngineError({
      message: 'auth',
      code: 'auth',
      retryable: false,
    });
    expect(shouldFallbackOnPiError(error)).toBe(false);
  });

  it('deve retornar false para invalid_response', () => {
    const error = new PiEngineError({
      message: 'invalid',
      code: 'invalid_response',
      retryable: false,
    });
    expect(shouldFallbackOnPiError(error)).toBe(false);
  });

  it('deve retornar false para unknown', () => {
    const error = new PiEngineError({
      message: 'unknown',
      code: 'unknown',
      retryable: false,
    });
    expect(shouldFallbackOnPiError(error)).toBe(false);
  });

  it('deve normalizar erro genérico antes de decidir', () => {
    const error = new Error('rate limit exceeded');
    expect(shouldFallbackOnPiError(error)).toBe(true);
  });

  it('deve normalizar DOMException AbortError antes de decidir', () => {
    const error = new DOMException('Aborted', 'AbortError');
    expect(shouldFallbackOnPiError(error)).toBe(false);
  });

  it('deve normalizar TypeError antes de decidir', () => {
    const error = new TypeError('network error');
    expect(shouldFallbackOnPiError(error)).toBe(true);
  });

  it('deve normalizar erro "unauthorized" antes de decidir', () => {
    const error = new Error('unauthorized');
    expect(shouldFallbackOnPiError(error)).toBe(false);
  });
});
