import { describe, it, expect } from 'vitest';
import { planSyncImport } from './data-management';

describe('planSyncImport', () => {
  it('ファイルに含まれる設定は書き込み対象になる', () => {
    const { set } = planSyncImport({ volumeStepCount: 100, speed: 1.5, darkMode: true });

    expect(set.volumeStepCount).toBe(100);
    expect(set.speed).toBe(1.5);
    expect(set.darkMode).toBe(true);
  });

  it('ファイルに含まれない設定は削除して初期値へ戻す', () => {
    const { set, remove } = planSyncImport({ volumeStepCount: 20 });

    // 初期値のままの設定は storage にもエクスポートファイルにも現れないため、
    // マージではなく削除しないと現在値が残ってしまう
    expect(remove).toContain('speed');
    expect(remove).toContain('filterConfig');
    expect(remove).toContain('popupSectionOrder');
    expect(remove).not.toContain('volumeStepCount');
    expect(Object.keys(set)).toEqual(['volumeStepCount']);
  });

  it('音量の細かさ（段階数）がインポートで復元される', () => {
    expect(planSyncImport({ volumeStepCount: 100 }).set.volumeStepCount).toBe(100);
    // 段階数が初期値（10段階）だったエクスポートは削除側に回り、初期値へ戻る
    expect(planSyncImport({ speed: 1.0 }).remove).toContain('volumeStepCount');
  });

  it('APIキーはファイルに含まれるときだけ上書きし、削除はしない', () => {
    const withoutKeys = planSyncImport({ speed: 1.0 });
    expect(withoutKeys.remove).not.toContain('apiKeyVOICEVOX');
    expect(withoutKeys.remove).not.toContain('apiKeyYoutube');
    expect(withoutKeys.set).not.toHaveProperty('apiKeyVOICEVOX');

    const withKeys = planSyncImport({ apiKeyVOICEVOX: 'abc', apiKeyYoutube: 'def' });
    expect(withKeys.set.apiKeyVOICEVOX).toBe('abc');
    expect(withKeys.set.apiKeyYoutube).toBe('def');
  });

  it('管理対象外のキーは取り込まない', () => {
    const { set } = planSyncImport({ speed: 1.0, unknownKey: 'x' });
    expect(set).not.toHaveProperty('unknownKey');
  });

  it('音量は復元後の段階数のグリッドに丸める', () => {
    // 100段階で保存した 0.37 を 10段階へ戻すと 0.4 になる
    expect(planSyncImport({ volume: 0.37 }).set.volume).toBeCloseTo(0.4);
    expect(planSyncImport({ volume: 0.37, volumeStepCount: 100 }).set.volume).toBeCloseTo(0.37);
  });
});
