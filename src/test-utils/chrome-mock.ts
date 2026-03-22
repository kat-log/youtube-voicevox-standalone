/**
 * Chrome API の in-memory スタブ
 * chrome.storage.sync / session の get/set をメモリ上で再現する。
 * 将来の rush-mode.test.ts, auto-catchup.test.ts 等で使用。
 */

type StorageData = Record<string, unknown>;

function createStorageArea() {
  let store: StorageData = {};

  return {
    get: (keys: string | string[] | null): Promise<StorageData> => {
      if (keys === null) return Promise.resolve({ ...store });
      const keyList = typeof keys === 'string' ? [keys] : keys;
      const result: StorageData = {};
      for (const key of keyList) {
        if (key in store) result[key] = store[key];
      }
      return Promise.resolve(result);
    },
    set: (items: StorageData): Promise<void> => {
      Object.assign(store, items);
      return Promise.resolve();
    },
    /** テスト間でストレージをリセットする */
    _clear: () => {
      store = {};
    },
  };
}

const syncStorage = createStorageArea();
const sessionStorage = createStorageArea();

export const chromeMock = {
  storage: {
    sync: { get: syncStorage.get, set: syncStorage.set },
    session: { get: sessionStorage.get, set: sessionStorage.set },
  },
  /** テスト間で全ストレージをリセット */
  _resetAll: () => {
    syncStorage._clear();
    sessionStorage._clear();
  },
};

/**
 * グローバルに chrome オブジェクトをモックとして設定する。
 * テストの setup で呼び出す。
 */
export function installChromeMock(): void {
  (globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;
}
