import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdempotencyStore, IdempotencyConflictError, stableStringify } from './idempotency-store.js';

describe('IdempotencyStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('deve executar handler na primeira chamada', async () => {
    const store = new IdempotencyStore(10000);
    const handler = vi.fn().mockResolvedValue('result');
    const result = await store.execute({
      key: 'test-key',
      signature: 'sig-1',
      handler
    });
    expect(result).toEqual({ replayed: false, value: 'result' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('deve retornar resultado cacheado na segunda chamada com mesmo signature', async () => {
    const store = new IdempotencyStore(10000);
    const handler = vi.fn().mockResolvedValue('result');
    const params = { key: 'test-key', signature: 'sig-1', handler };
    
    await store.execute(params);
    const result = await store.execute(params);
    
    expect(result).toEqual({ replayed: true, value: 'result' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('deve lançar IdempotencyConflictError com mesma key e signature diferente', async () => {
    const store = new IdempotencyStore(10000);
    const handler1 = vi.fn().mockResolvedValue('result1');
    const handler2 = vi.fn().mockResolvedValue('result2');
    
    await store.execute({ key: 'test-key', signature: 'sig-1', handler: handler1 });
    await expect(
      store.execute({ key: 'test-key', signature: 'sig-2', handler: handler2 })
    ).rejects.toThrow(IdempotencyConflictError);
    
    expect(handler2).not.toHaveBeenCalled();
  });

  it('deve lidar com chamadas simultâneas (inFlight)', async () => {
    const store = new IdempotencyStore(10000);
    let resolveHandler: (value: string) => void;
    const handler = vi.fn().mockImplementation(() => new Promise(r => resolveHandler = r));
    
    const promise1 = store.execute({ key: 'test-key', signature: 'sig-1', handler });
    const promise2 = store.execute({ key: 'test-key', signature: 'sig-1', handler });
    
    expect(handler).toHaveBeenCalledTimes(1);
    
    resolveHandler!('result');
    
    const [result1, result2] = await Promise.all([promise1, promise2]);
    
    expect(result1).toEqual({ replayed: false, value: 'result' });
    expect(result2).toEqual({ replayed: true, value: 'result' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('deve limpar entradas expiradas automaticamente', async () => {
    const store = new IdempotencyStore(100);
    const handler1 = vi.fn().mockResolvedValue('result1');
    const handler2 = vi.fn().mockResolvedValue('result2');
    
    await store.execute({ key: 'test-key', signature: 'sig-1', handler: handler1 });
    
    vi.advanceTimersByTime(150);
    
    const result = await store.execute({ key: 'test-key', signature: 'sig-2', handler: handler2 });
    
    expect(result).toEqual({ replayed: false, value: 'result2' });
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('deve limpar entradas expiradas manualmente com cleanup()', async () => {
    const store = new IdempotencyStore(10000);
    const handler1 = vi.fn().mockResolvedValue('result1');
    const handler2 = vi.fn().mockResolvedValue('result2');
    
    await store.execute({ key: 'test-key', signature: 'sig-1', handler: handler1 });
    
    vi.setSystemTime(Date.now() + 15000);
    store.cleanup();
    
    const result = await store.execute({ key: 'test-key', signature: 'sig-2', handler: handler2 });
    
    expect(result).toEqual({ replayed: false, value: 'result2' });
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('deve manter múltiplas keys distintas', async () => {
    const store = new IdempotencyStore(10000);
    const handler1 = vi.fn().mockResolvedValue('result1');
    const handler2 = vi.fn().mockResolvedValue('result2');
    
    await store.execute({ key: 'key-1', signature: 'sig-1', handler: handler1 });
    await store.execute({ key: 'key-2', signature: 'sig-2', handler: handler2 });
    
    const result1 = await store.execute({ key: 'key-1', signature: 'sig-1', handler: handler1 });
    const result2 = await store.execute({ key: 'key-2', signature: 'sig-2', handler: handler2 });
    
    expect(result1).toEqual({ replayed: true, value: 'result1' });
    expect(result2).toEqual({ replayed: true, value: 'result2' });
    
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('deve remover inFlight após handler completar', async () => {
    const store = new IdempotencyStore(10000);
    const handler = vi.fn().mockResolvedValue('result');
    
    const promise = store.execute({ key: 'test-key', signature: 'sig-1', handler });
    await promise;
    
    const result = await store.execute({ key: 'test-key', signature: 'sig-1', handler });
    
    expect(result).toEqual({ replayed: true, value: 'result' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('deve remover inFlight após handler falhar', async () => {
    const store = new IdempotencyStore(10000);
    const handler = vi.fn().mockRejectedValue(new Error('error'));
    
    await expect(
      store.execute({ key: 'test-key', signature: 'sig-1', handler })
    ).rejects.toThrow('error');
    
    const handler2 = vi.fn().mockResolvedValue('result2');
    const result = await store.execute({ key: 'test-key', signature: 'sig-1', handler: handler2 });
    
    expect(result).toEqual({ replayed: false, value: 'result2' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('deve retornar valor tipado corretamente', async () => {
    const store = new IdempotencyStore(10000);
    const expectedValue = { id: 123, name: 'test' };
    const handler = vi.fn().mockResolvedValue(expectedValue);
    
    const result = await store.execute({
      key: 'test-key',
      signature: 'sig-1',
      handler
    });
    
    expect(result.value).toEqual(expectedValue);
  });
});

describe('stableStringify', () => {
  it('deve stringify objetos com chaves ordenadas alfabeticamente', () => {
    const obj = { z: 1, a: 2, m: 3 };
    const result = stableStringify(obj);
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('deve stringify arrays mantendo ordem', () => {
    const arr = [3, 1, 2];
    expect(stableStringify(arr)).toBe('[3,1,2]');
  });

  it('deve stringify objetos aninhados com chaves ordenadas', () => {
    const obj = { b: { z: 1, a: 2 }, a: 3 };
    const result = stableStringify(obj);
    expect(result).toBe('{"a":3,"b":{"a":2,"z":1}}');
  });

  it('deve stringify arrays aninhadas', () => {
    const obj = { arr: [{ z: 1, a: 2 }, { m: 3, b: 4 }] };
    const result = stableStringify(obj);
    expect(result).toBe('{"arr":[{"a":2,"z":1},{"b":4,"m":3}]}');
  });

  it('deve stringify valores primitivos', () => {
    expect(stableStringify('string')).toBe('"string"');
    expect(stableStringify(123)).toBe('123');
    expect(stableStringify(true)).toBe('true');
    expect(stableStringify(null)).toBe('null');
  });

  it('deve stringify objeto vazio', () => {
    expect(stableStringify({})).toBe('{}');
  });

  it('deve stringify array vazio', () => {
    expect(stableStringify([])).toBe('[]');
  });

  it('deve usar JSON.stringify para valores primitivos', () => {
    expect(stableStringify('test')).toBe(JSON.stringify('test'));
    expect(stableStringify(42)).toBe(JSON.stringify(42));
  });

  it('deve lidar com chaves numéricas como strings', () => {
    const obj = { "2": 'b', "1": 'a', "3": 'c' };
    const result = stableStringify(obj);
    expect(result).toBe('{"1":"a","2":"b","3":"c"}');
  });

  it('deve ser determinístico (mesma entrada, mesma saída)', () => {
    const obj = { c: 3, a: 1, b: 2 };
    const result1 = stableStringify(obj);
    const result2 = stableStringify(obj);
    expect(result1).toBe(result2);
  });
});
