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
      expect(shouldFilter('ab', config)).toBeTruthy();
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
      expect(shouldFilter('abcdef', config)).toBeTruthy();
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
      expect(shouldFilter('😀🎉', config)).toBeTruthy();
    });

    it('テキスト混在メッセージは通過', () => {
      const config: FilterConfig = { ...baseConfig, skipEmojiOnly: true };
      expect(shouldFilter('こんにちは😀', config)).toBe(false);
    });

    it('skipEmojiOnly が false なら絵文字のみでも通過', () => {
      const config: FilterConfig = { ...baseConfig, skipEmojiOnly: false };
      expect(shouldFilter('😀🎉', config)).toBe(false);
    });

    it('ショートコードのみメッセージはフィルタ', () => {
      const config: FilterConfig = { ...baseConfig, skipEmojiOnly: true };
      expect(shouldFilter(':koroneMimidokan::koroneMimidokan:', config)).toBeTruthy();
    });

    it('日本語ショートコードのみメッセージはフィルタ', () => {
      const config: FilterConfig = { ...baseConfig, skipEmojiOnly: true };
      expect(shouldFilter(':_だいそうげん::_だいそうげん:', config)).toBeTruthy();
    });
  });

  describe('ngWords', () => {
    it('NGワードを含むメッセージはフィルタ', () => {
      const config: FilterConfig = { ...baseConfig, ngWords: ['spam'] };
      expect(shouldFilter('this is spam message', config)).toBeTruthy();
    });

    it('NGワードを含まないメッセージは通過', () => {
      const config: FilterConfig = { ...baseConfig, ngWords: ['spam'] };
      expect(shouldFilter('hello world', config)).toBe(false);
    });

    it('大文字小文字を無視してマッチ', () => {
      const config: FilterConfig = { ...baseConfig, ngWords: ['SPAM'] };
      expect(shouldFilter('this is spam', config)).toBeTruthy();
    });

    it('全角NGワードで半角テキストをフィルタ', () => {
      const config: FilterConfig = { ...baseConfig, ngWords: ['ＮＧ'] };
      expect(shouldFilter('これはNGです', config)).toBeTruthy();
    });

    it('半角NGワードで全角テキストをフィルタ', () => {
      const config: FilterConfig = { ...baseConfig, ngWords: ['NG'] };
      expect(shouldFilter('これはＮＧです', config)).toBeTruthy();
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

  it('日本語含むカスタム絵文字コードを除去', () => {
    expect(stripEmojis(':_だいそうげん::_だいそうげん::_だいそうげん:')).toBe('');
  });

  it('日本語含むカスタム絵文字コードをテキスト混在から除去', () => {
    expect(stripEmojis('こんにちは:_だいそうげん:世界')).toBe('こんにちは世界');
  });

  it('コロンなしテキストはそのまま（DOM側でコロン付与を期待）', () => {
    expect(stripEmojis('koroneMimidokan')).toBe('koroneMimidokan');
  });

  it('コロン付きカスタム絵文字コードを除去', () => {
    expect(stripEmojis(':koroneMimidokan::koroneMimidokan:')).toBe('');
  });

  // 回帰: DOM取得経路では標準Unicode絵文字もコロンで包まれることがあり
  // （旧 dom-chat.ts の挙動）、置換順が誤っていると孤立コロンが
  // 次のコロンとペアになって間の本文を巻き込んで削除していた
  it('コロンで包まれたUnicode絵文字の後ろの本文が消えない', () => {
    expect(stripEmojis('兄者さん⸜:🙌🏻:⸝‍おはようございます:KyoyuAnijyaKyoyu:')).toBe(
      '兄者さん⸜⸝おはようございます'
    );
  });

  it('コロンで包まれたUnicode絵文字が複数あっても本文が消えない', () => {
    expect(stripEmojis('兄者おはよう:💙:今日もFIGHTです:🥰::✨:')).toBe(
      '兄者おはよう今日もFIGHTです'
    );
  });

  it('生の絵文字（API取得経路）でもDOM取得経路と同じ結果になる', () => {
    expect(stripEmojis('兄者さん⸜🙌🏻⸝‍おはようございます:KyoyuAnijyaKyoyu:')).toBe(
      '兄者さん⸜⸝おはようございます'
    );
    expect(stripEmojis('兄者おはよう💙今日もFIGHTです🥰✨')).toBe('兄者おはよう今日もFIGHTです');
  });

  it('スキントーン修飾子付き絵文字をコロンで包んでも本文が残る', () => {
    expect(stripEmojis('おはよう:👍🏽:こんばんは')).toBe('おはようこんばんは');
  });

  it('単独で残るZWJ・異体字セレクタを除去', () => {
    expect(stripEmojis('あ\u200Dい\uFE0Fう')).toBe('あいう');
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
