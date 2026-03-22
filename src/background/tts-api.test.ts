import { describe, it, expect } from 'vitest';
import { RateLimitError } from './tts-api';

describe('RateLimitError', () => {
  it('retryAfter の値を保持する', () => {
    const error = new RateLimitError(10);
    expect(error.retryAfter).toBe(10);
  });

  it('name が "RateLimitError" である', () => {
    const error = new RateLimitError(5);
    expect(error.name).toBe('RateLimitError');
  });

  it('メッセージに retryAfter の秒数を含む', () => {
    const error = new RateLimitError(30);
    expect(error.message).toBe('Rate limited: retry after 30s');
  });

  it('Error のインスタンスである', () => {
    const error = new RateLimitError(5);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RateLimitError);
  });
});
