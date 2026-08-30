import { describe, it, expect, beforeEach, vi } from 'vitest';

type Store = Record<string, unknown>;

function pick(store: Store, keys: unknown): Store {
  if (keys === null || keys === undefined) return { ...store };
  if (typeof keys === 'string') {
    return keys in store ? { [keys]: store[keys] } : {};
  }
  if (Array.isArray(keys)) {
    const result: Store = {};
    for (const key of keys) {
      if (key in store) result[key] = store[key];
    }
    return result;
  }
  // デフォルト値付きオブジェクト形式
  const defaults = keys as Store;
  const result: Store = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (key in store) result[key] = store[key];
  }
  return result;
}

function createArea(store: Store) {
  return {
    get: (keys?: unknown, cb?: (data: Store) => void) => {
      const result = pick(store, keys);
      if (typeof cb === 'function') {
        cb(result);
        return undefined;
      }
      return Promise.resolve(result);
    },
    set: (items: Store, cb?: () => void) => {
      Object.assign(store, items);
      cb?.();
      return Promise.resolve();
    },
    remove: (key: string) => {
      delete store[key];
      return Promise.resolve();
    },
  };
}

let syncStore: Store;
let sessionStore: Store;
let sentMessages: Record<string, unknown>[];

function installChrome(): void {
  syncStore = {};
  sessionStore = {};
  sentMessages = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      sync: createArea(syncStore),
      session: createArea(sessionStore),
      local: createArea({}),
      onChanged: { addListener: vi.fn() },
    },
    runtime: {
      sendMessage: (message: Record<string, unknown>) => {
        sentMessages.push(message);
        return Promise.resolve();
      },
    },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    tts: { getVoices: (cb: (v: unknown[]) => void) => cb([]) },
  };
}

/** マイクロタスク・タイマーを消化する */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function change(newValue: unknown): chrome.storage.StorageChange {
  return { newValue } as chrome.storage.StorageChange;
}

beforeEach(() => {
  vi.resetModules();
  installChrome();
});

describe('applySyncStorageChanges: 再生設定', () => {
  it('storage 直接変更（設定インポート）で音量キャッシュが更新される', async () => {
    const { applySyncStorageChanges } = await import('./settings-sync');
    const { getCachedVolume } = await import('./audio-player');

    expect(getCachedVolume()).toBe(1.0);

    applySyncStorageChanges({ volume: change(0.25) });

    expect(getCachedVolume()).toBe(0.25);
    expect(sentMessages).toContainEqual({
      target: 'offscreen',
      action: 'setVolume',
      volume: 0.25,
    });
  });

  it('キャッシュと同値の変更は再適用しない（popup 由来の二重適用防止）', async () => {
    const { applySyncStorageChanges } = await import('./settings-sync');

    applySyncStorageChanges({ volume: change(1.0) });

    expect(sentMessages.some((m) => m.action === 'setVolume')).toBe(false);
  });

  it('キーが削除された場合はデフォルト値に戻る', async () => {
    const { applySyncStorageChanges } = await import('./settings-sync');
    const { getCachedVolume } = await import('./audio-player');

    applySyncStorageChanges({ volume: change(0.25) });
    expect(getCachedVolume()).toBe(0.25);

    applySyncStorageChanges({ volume: change(undefined) });
    expect(getCachedVolume()).toBe(1.0);
  });

  it('速度変更で生成待ちキューの速度も揃う', async () => {
    const { applySyncStorageChanges } = await import('./settings-sync');
    const { getCachedSpeed } = await import('./audio-player');
    const { getState, updateState } = await import('./state');

    updateState({
      commentQueue: [
        { apiKeyVOICEVOX: '', newMessage: 'a', speed: 1.0, tabId: 1 },
        { apiKeyVOICEVOX: '', newMessage: 'b', speed: 1.0, tabId: 1 },
      ],
    });

    applySyncStorageChanges({ speed: change(1.5) });

    expect(getCachedSpeed()).toBe(1.5);
    expect(getState().commentQueue.map((c) => c.speed)).toEqual([1.5, 1.5]);
  });

  it('最新N件モードの変更が state に反映される', async () => {
    const { applySyncStorageChanges } = await import('./settings-sync');
    const { getState } = await import('./state');

    applySyncStorageChanges({
      latestOnlyMode: change(true),
      latestOnlyCount: change(10),
    });

    expect(getState().latestOnlyMode).toBe(true);
    expect(getState().latestOnlyCount).toBe(10);
  });
});

describe('applySyncStorageChanges: ランダム話者', () => {
  const localSpeakers = [
    { name: 'A', styles: [{ id: 1, name: 'normal' }] },
    { name: 'B', styles: [{ id: 2, name: 'normal' }] },
    { name: 'C', styles: [{ id: 3, name: 'normal' }] },
  ];

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(localSpeakers) } as Response)
      )
    );
  });

  it('インポートでランダム話者ONと許可リストが反映される', async () => {
    const { applySyncStorageChanges } = await import('./settings-sync');
    const { isRandomSpeakerEnabled, getRandomSpeakerId } = await import('./random-speaker');

    syncStore.ttsEngine = 'local-voicevox';
    syncStore.randomSpeakerEnabled = true;
    syncStore.randomSpeakerAllowedIdsLocal = ['3'];

    applySyncStorageChanges({
      randomSpeakerEnabled: change(true),
      randomSpeakerAllowedIdsLocal: change(['3']),
    });
    await flush();

    expect(isRandomSpeakerEnabled()).toBe(true);
    expect(getRandomSpeakerId()).toBe('3');
  });

  it('話者リスト取得済みでも許可リストの変更が即座に反映される', async () => {
    const { applySyncStorageChanges } = await import('./settings-sync');
    const { loadRandomSpeakerConfigFromStorage, getRandomSpeakerId } =
      await import('./random-speaker');

    // 全話者許可の状態で話者リストを取得済みにする
    syncStore.ttsEngine = 'local-voicevox';
    syncStore.randomSpeakerEnabled = true;
    loadRandomSpeakerConfigFromStorage();
    await flush();
    expect(['1', '2', '3']).toContain(getRandomSpeakerId());

    // お気に入りプリセットのインポート相当
    syncStore.randomSpeakerAllowedIdsLocal = ['2'];
    applySyncStorageChanges({ randomSpeakerAllowedIdsLocal: change(['2']) });
    await flush();

    expect(getRandomSpeakerId()).toBe('2');
  });

  it('ランダム話者OFFのインポートで無効化される', async () => {
    const { applySyncStorageChanges } = await import('./settings-sync');
    const { loadRandomSpeakerConfigFromStorage, isRandomSpeakerEnabled } =
      await import('./random-speaker');

    syncStore.randomSpeakerEnabled = true;
    loadRandomSpeakerConfigFromStorage();
    await flush();
    expect(isRandomSpeakerEnabled()).toBe(true);

    syncStore.randomSpeakerEnabled = false;
    applySyncStorageChanges({ randomSpeakerEnabled: change(false) });
    await flush();

    expect(isRandomSpeakerEnabled()).toBe(false);
  });
});

describe('applySyncStorageChanges: 設定オブジェクト', () => {
  it('フィルタ設定のインポートが反映される', async () => {
    const { applySyncStorageChanges } = await import('./settings-sync');
    const { getFilterConfig } = await import('./comment-filter');

    syncStore.filterConfig = { enabled: true, minLength: 5 };
    applySyncStorageChanges({ filterConfig: change(syncStore.filterConfig) });
    await flush();

    expect(getFilterConfig().enabled).toBe(true);
    expect(getFilterConfig().minLength).toBe(5);
    // 未指定項目はデフォルトで補完される
    expect(getFilterConfig().ngWordAction).toBe('remove');
  });

  it('設定リセット（キー削除）でデフォルトに戻る', async () => {
    const { applySyncStorageChanges } = await import('./settings-sync');
    const { getFilterConfig } = await import('./comment-filter');

    syncStore.filterConfig = { enabled: true, minLength: 5 };
    applySyncStorageChanges({ filterConfig: change(syncStore.filterConfig) });
    await flush();
    expect(getFilterConfig().enabled).toBe(true);

    delete syncStore.filterConfig;
    applySyncStorageChanges({ filterConfig: change(undefined) });
    await flush();

    expect(getFilterConfig().enabled).toBe(false);
    expect(getFilterConfig().minLength).toBe(1);
  });

  it('ラッシュモード設定のインポートが反映される', async () => {
    const { applySyncStorageChanges } = await import('./settings-sync');
    const { getRushConfig } = await import('./rush-mode');

    syncStore.rushModeConfig = { enabled: true, rushSpeed: 2.0 };
    applySyncStorageChanges({ rushModeConfig: change(syncStore.rushModeConfig) });
    await flush();

    expect(getRushConfig().enabled).toBe(true);
    expect(getRushConfig().rushSpeed).toBe(2.0);
  });
});

describe('applySyncStorageChanges: 話者ID', () => {
  it('実行中セッションの話者IDが更新される', async () => {
    const { applySyncStorageChanges } = await import('./settings-sync');
    const { setStandaloneConfig, getStandaloneConfig } = await import('./lifecycle-internal');

    setStandaloneConfig({ apiKeyVOICEVOX: '', speed: 1.0, tabId: 1, speakerId: '1' });

    syncStore.ttsEngine = 'local-voicevox';
    syncStore.localSpeakerId = '8';
    applySyncStorageChanges({ localSpeakerId: change('8') });
    await flush();

    expect(getStandaloneConfig()?.speakerId).toBe('8');
  });

  it('ランダム話者のセンチネル値は話者IDとして渡さない', async () => {
    const { applySyncStorageChanges } = await import('./settings-sync');
    const { setStandaloneConfig, getStandaloneConfig } = await import('./lifecycle-internal');
    const { RANDOM_SPEAKER_SENTINEL } = await import('@/types/state');

    setStandaloneConfig({ apiKeyVOICEVOX: '', speed: 1.0, tabId: 1, speakerId: '1' });

    syncStore.ttsEngine = 'voicevox';
    syncStore.speakerId = RANDOM_SPEAKER_SENTINEL;
    applySyncStorageChanges({ speakerId: change(RANDOM_SPEAKER_SENTINEL) });
    await flush();

    expect(getStandaloneConfig()?.speakerId).toBeUndefined();
  });
});
