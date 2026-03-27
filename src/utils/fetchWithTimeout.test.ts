import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout } from './fetchWithTimeout';

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('正常応答時はfetchの結果をそのまま返す', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    vi.mocked(fetch).mockResolvedValue(mockResponse);

    const result = await fetchWithTimeout('https://example.com', 5000);
    expect(result).toBe(mockResponse);
    expect(fetch).toHaveBeenCalledWith('https://example.com', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });

  it('initオプションをfetchに渡す', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    vi.mocked(fetch).mockResolvedValue(mockResponse);

    await fetchWithTimeout('https://example.com', 5000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(fetch).toHaveBeenCalledWith('https://example.com', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: expect.any(AbortSignal),
    }));
  });

  it('タイムアウト超過時にAbortErrorをスローする', async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const promise = fetchWithTimeout('https://example.com', 3000);
    vi.advanceTimersByTime(3000);

    await expect(promise).rejects.toThrow('The operation was aborted.');
  });

  it('fetchエラー時はそのままスローする', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetchWithTimeout('https://example.com', 5000)).rejects.toThrow('Failed to fetch');
  });
});
