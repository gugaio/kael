import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retry, computeDelayMs, type RetryPolicy } from './retry.js';

describe('computeDelayMs', () => {
  it('deve calcular backoff exponencial sem jitter', () => {
    const policy: RetryPolicy = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
    expect(computeDelayMs(policy, 1)).toBe(100);
    expect(computeDelayMs(policy, 2)).toBe(200);
    expect(computeDelayMs(policy, 3)).toBe(400);
  });

  it('deve aplicar cap no maxDelayMs', () => {
    const policy: RetryPolicy = { attempts: 5, baseDelayMs: 100, maxDelayMs: 150, jitterMs: 0 };
    expect(computeDelayMs(policy, 3)).toBe(150);
  });

  it('deve adicionar jitter aleatório dentro do range', () => {
    const policy: RetryPolicy = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 50 };
    const delays = Array.from({ length: 100 }, () => computeDelayMs(policy, 2));
    const baseDelay = 200;
    const allInRange = delays.every(d => d >= baseDelay && d <= baseDelay + 50);
    expect(allInRange).toBe(true);
  });

  it('não deve adicionar jitter quando jitterMs é 0', () => {
    const policy: RetryPolicy = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
    const delay = computeDelayMs(policy, 1);
    expect(delay).toBe(100);
  });
});

describe('retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deve retornar sucesso na primeira tentativa', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    const policy: RetryPolicy = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
    const result = await retry(operation, policy, () => true);
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('deve retry 2 vezes antes de sucesso (3 tentativas total)', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');
    const policy: RetryPolicy = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
    
    const promise = retry(operation, policy, () => true);
    
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    
    const result = await promise;
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('deve fazer retry até maxAttempts', async () => {
    const operation = vi.fn()
      .mockRejectedValue(new Error('always fails'));
    const policy: RetryPolicy = { attempts: 5, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
    
    const promise = retry(operation, policy, () => true);
    
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(800);
    
    await expect(promise).rejects.toThrow('always fails');
    expect(operation).toHaveBeenCalledTimes(5);
  });

  it('não deve retry em erro não retryable', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('non-retryable'));
    const policy: RetryPolicy = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
    await expect(
      retry(operation, policy, () => false)
    ).rejects.toThrow('non-retryable');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('deve aplicar delay entre tentativas', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('success');
    const policy: RetryPolicy = { attempts: 2, baseDelayMs: 50, maxDelayMs: 1000, jitterMs: 0 };
    
    const promise = retry(operation, policy, () => true);
    
    await vi.advanceTimersByTimeAsync(50);
    
    await promise;
    
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('deve aplicar backoff exponencial nos delays', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');
    const policy: RetryPolicy = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
    
    const promise = retry(operation, policy, () => true);
    
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();
    
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    
    await promise;
    
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('deve usar RetryContext corretamente em shouldRetry', async () => {
    const shouldRetry = vi.fn((ctx) => ctx.attempt < 2);
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'));
    const policy: RetryPolicy = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
    
    const promise = retry(operation, policy, shouldRetry);
    
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    
    await expect(promise).rejects.toThrow('fail 2');
    
    expect(shouldRetry).toHaveBeenCalledTimes(2);
    expect(shouldRetry).toHaveBeenNthCalledWith(1, { attempt: 1, maxAttempts: 3, error: expect.any(Error) });
    expect(shouldRetry).toHaveBeenNthCalledWith(2, { attempt: 2, maxAttempts: 3, error: expect.any(Error) });
  });

  it('deve respeitar attempts = 1 (sem retry)', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('fail'));
    const policy: RetryPolicy = { attempts: 1, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
    await expect(
      retry(operation, policy, () => true)
    ).rejects.toThrow('fail');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('deve lançar erro quando attempts é 0 (usa 1 como mínimo)', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    const policy: RetryPolicy = { attempts: 0, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
    const result = await retry(operation, policy, () => true);
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('deve lançar erro quando attempts é negativo (usa 1 como mínimo)', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    const policy: RetryPolicy = { attempts: -5, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
    const result = await retry(operation, policy, () => true);
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('deve lançar o último erro quando exaustar tentativas', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('last error'));
    const policy: RetryPolicy = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
    
    const promise = retry(operation, policy, () => true);
    
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    
    await expect(promise).rejects.toThrow('last error');
  });

  it('deve fazer retry quando shouldRetry retorna true na última tentativa', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockRejectedValueOnce(new Error('fail 3'));
    const policy: RetryPolicy = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
    
    const promise = retry(operation, policy, () => true);
    
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    
    await expect(promise).rejects.toThrow('fail 3');
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
