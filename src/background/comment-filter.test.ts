import { describe, it, expect } from 'vitest';
import { shouldFilter, stripEmojis, removeNgWords } from './comment-filter';
import type { FilterConfig } from './comment-filter';

const baseConfig: FilterConfig = {
  enabled: true,
  minLength: 1,
  maxLength: 0,
  skipEmojiOnly: false,
  stripEmoji: false,
  ngWords: [],
  ngWordAction: 'remove',
};

describe('shouldFilter', () => {
  it('enabled: false なら常に false', () => {
    const config: FilterConfig = { ...baseConfig, enabled: false, ngWords: ['NG'] };
    expect(shouldFilter('NGワード含む', config)).toBe(false);
  });

  describe('minLength', () => {
    it('文字数が minLength 未満ならフィルタ', () => {
      const config: FilterConfig = { ...baseConfig, minLength: 3 };
      expect(shouldFilter('ab', config)).toBe(true);
    });

    it('文字数が minLength と等しければ通過', () => {
      const config: FilterConfig = { ...baseConfig, minLength: 3 };
      expect(shouldFilter('abc', config)).toBe(false);
    });

    it('minLength=1 は1文字でも通過', () => {
      const config: FilterConfig = { ...baseConfig, minLength: 1 };
      expect(shouldFilter('a', config)).toBe(false);
    });
  });

  describe('maxLength', () => {
    it('文字数が maxLength を超えたらフィルタ', () => {
      const config: FilterConfig = { ...baseConfig, maxLength: 5 };
      expect(shouldFilter('abcdef', config)).toBe(true);
    });

    it('文字数が maxLength と等しければ通過', () => {
      const config: FilterConfig = { ...baseConfig, maxLength: 5 };
      expect(shouldFilter('abcde', config)).toBe(false);
    });

    it('maxLength=0 (無制限) は長い文字列でも通過', () => {
      const config: FilterConfig = { ...baseConfig, maxLength: 0 };
      expect(shouldFilter('a'.repeat(10000), config)).toBe(false);
    });
  });

  describe('skipEmojiOnly', () => {
    it('絵文字のみメッセージはフィルタ', () => {
      const config: FilterConfig = { ...baseConfig, skipEmojiOnly: true };
      expect(shouldFilter('😀🎉', config)).toBe(true);
    });

    it('テキスト混在メッセージは通過', () => {
      const config: FilterConfig = { ...baseConfig, skipEmojiOnly: true };
      expect(shouldFilter('こんにちは😀', config)).toBe(false);
    });

    it('skipEmojiOnly が false なら絵文字のみでも通過', () => {
      const config: FilterConfig = { ...baseConfig, skipEmojiOnly: false };
      expect(shouldFilter('😀🎉', config)).toBe(false);
    });
  });

  describe('ngWords', () => {
    it('NGワードを含むメッセージはフィルタ', () => {
      const config: FilterConfig = { ...baseConfig, ngWords: ['spam'] };
      expect(shouldFilter('this is spam message', config)).toBe(true);
    });

    it('NGワードを含まないメッセージは通過', () => {
      const config: FilterConfig = { ...baseConfig, ngWords: ['spam'] };
      expect(shouldFilter('hello world', config)).toBe(false);
    });

    it('大文字小文字を無視してマッチ', () => {
      const config: FilterConfig = { ...baseConfig, ngWords: ['SPAM'] };
      expect(shouldFilter('this is spam', config)).toBe(true);
    });

    it('全角NGワードで半角テキストをフィルタ', () => {
      const config: FilterConfig = { ...baseConfig, ngWords: ['ＮＧ'] };
      expect(shouldFilter('これはNGです', config)).toBe(true);
    });

    it('半角NGワードで全角テキストをフィルタ', () => {
      const config: FilterConfig = { ...baseConfig, ngWords: ['NG'] };
      expect(shouldFilter('これはＮＧです', config)).toBe(true);
    });
  });
});

describe('stripEmojis', () => {
  it('Unicode絵文字を除去', () => {
    expect(stripEmojis('hello😀world')).toBe('helloworld');
  });

  it('ZWJ sequences を除去', () => {
    expect(stripEmojis('家族👨‍👩‍👧だよ')).toBe('家族だよ');
  });

  it('YouTube shortcode を除去', () => {
    expect(stripEmojis('hello:thumbsup:world')).toBe('helloworld');
  });

  it('YouTube カスタム絵文字コードを除去', () => {
    expect(stripEmojis('test:_2BROOtojya:end')).toBe('testend');
  });

  it('絵文字+テキスト混在からテキストのみ残る', () => {
    expect(stripEmojis('😀こんにちは🎉世界👍')).toBe('こんにちは世界');
  });

  it('絵文字なしテキストはそのまま', () => {
    expect(stripEmojis('hello world')).toBe('hello world');
  });

  it('連続スペースをトリム', () => {
    expect(stripEmojis('hello  😀  world')).toBe('hello world');
  });

  it('絵文字のみなら空文字列', () => {
    expect(stripEmojis('😀🎉👍')).toBe('');
  });
});

describe('removeNgWords', () => {
  it('部分一致でNGワードを除去', () => {
    expect(removeNgWords('これはスパムです', ['スパム'])).toBe('これはです');
  });

  it('大文字小文字を無視して除去', () => {
    expect(removeNgWords('This is SPAM', ['spam'])).toBe('This is');
  });

  it('全角半角を正規化して除去', () => {
    expect(removeNgWords('これはＮＧです', ['NG'])).toBe('これはです');
  });

  it('複数NGワードを同時除去', () => {
    expect(removeNgWords('spamとadを除去', ['spam', 'ad'])).toBe('とを除去');
  });

  it('NGワードが含まれなければそのまま', () => {
    expect(removeNgWords('正常なメッセージ', ['spam'])).toBe('正常なメッセージ');
  });

  it('空のNGワード配列ならそのまま', () => {
    expect(removeNgWords('なんでもOK', [])).toBe('なんでもOK');
  });

  it('正規表現の特殊文字をエスケープ', () => {
    expect(removeNgWords('price is $100', ['$100'])).toBe('price is');
  });
});
