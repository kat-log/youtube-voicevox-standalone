import type { TtsEngine } from '@/types/state';
import { stripRandomSentinel } from '@/types/state';
import { getState, updateState, incrementSessionId } from './state';
import {
  DEFAULT_SPEED,
  DEFAULT_VOLUME,
  getCachedSpeed,
  getCachedVolume,
  updateCachedSpeed,
  updateCachedVolume,
} from './audio-player';
import { loadFilterConfigFromStorage } from './comment-filter';
import { loadRushConfigFromStorage, evaluateRushMode } from './rush-mode';
import { loadRandomSpeedConfigFromStorage } from './random-speed';
import { loadAutoCatchUpConfigFromStorage } from './auto-catchup';
import {
  loadParallelPlaybackConfigFromStorage,
  loadParallelSpeakersConfigFromStorage,
} from './parallel-playback';
import {
  DEFAULT_LOCAL_VOICEVOX_HOST,
  DEFAULT_TTS_ENGINE,
  loadRandomSpeakerConfigFromStorage,
} from './random-speaker';
import {
  cancelScheduledProcessing,
  getBrowserVoice,
  getLocalVoicevoxHost,
  getMaxParallelSynthesis,
  getTtsEngine,
  setBrowserVoice,
  setLocalVoicevoxHost,
  setMaxParallelSynthesis,
  setTtsEngine,
} from './tts-api';
import { initLocalSpeakerNames, setSpeakerNameEngine } from './speaker-names';
import { updateStandaloneSpeakerId } from './lifecycle-internal';
import { updatePollingSpeakerId } from './lifecycle';
import { logInfo } from './messaging';

// これ以上のキーが一度に変わったら設定インポート等の一括変更とみなしてログに残す
const BULK_CHANGE_THRESHOLD = 5;

const DEFAULT_PARALLEL_SYNTHESIS = 3;
const DEFAULT_LATEST_ONLY_COUNT = 3;

const VALID_TTS_ENGINES: TtsEngine[] = ['voicevox', 'browser', 'local-voicevox'];

// background がキャッシュしている設定のうち、storage 変更を監視するキー
const RANDOM_SPEAKER_KEYS = [
  'randomSpeakerEnabled',
  'randomSpeakerAllowedIds',
  'randomSpeakerAllowedIdsLocal',
  'randomSpeakerAllowedIdsBrowser',
  'ttsEngine',
  'localVoicevoxHost',
];

const SPEAKER_ID_KEYS = ['speakerId', 'localSpeakerId', 'ttsEngine'];

type Changes = Record<string, chrome.storage.StorageChange>;

/**
 * background の設定キャッシュを storage の変更に追従させる。
 *
 * background は再生時の参照コストを避けるため設定をモジュール変数にキャッシュしており、
 * 通常は popup からのメッセージで更新される。しかし設定インポートやリセットのように
 * storage を直接書き換える経路ではメッセージが飛ばないため、
 * 「popup の表示は新しい値なのに再生は古い値のまま」というズレが生じる。
 * ここで storage.onChanged を購読し、その経路でもキャッシュを更新する。
 */
export function initSettingsSync(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    applySyncStorageChanges(changes);
  });
}

/** storage の変更内容を background のキャッシュへ反映する（テストから直接呼べるよう export） */
export function applySyncStorageChanges(changes: Changes): void {
  // 設定インポート等の一括書き込みはまとめて 1 件のイベントで届く
  const changedKeys = Object.keys(changes);
  if (changedKeys.length >= BULK_CHANGE_THRESHOLD) {
    logInfo(
      `設定の一括変更を検知しました（${changedKeys.length}項目）— 再生設定を再読み込みします`
    );
  }

  applyPlaybackChanges(changes);
  applyLatestOnlyChanges(changes);
  applyTtsEngineChanges(changes);
  applyConfigObjectChanges(changes);

  if (RANDOM_SPEAKER_KEYS.some((key) => key in changes)) {
    loadRandomSpeakerConfigFromStorage();
  }

  if (SPEAKER_ID_KEYS.some((key) => key in changes)) {
    void syncActiveSpeakerId();
  }
}

/** 変更後の値が現在のキャッシュと異なるか判定する（popup 由来の適用済み変更を再適用しないため） */
function isChanged(changes: Changes, key: string, current: unknown): boolean {
  if (!(key in changes)) return false;
  return JSON.stringify(changes[key].newValue ?? null) !== JSON.stringify(current ?? null);
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sendToOffscreen(message: Record<string, unknown>): void {
  chrome.runtime.sendMessage({ target: 'offscreen', ...message }).catch(() => {});
}

// 音量・速度（再生時に参照されるキャッシュ）
function applyPlaybackChanges(changes: Changes): void {
  if (isChanged(changes, 'volume', getCachedVolume())) {
    const volume = toNumber(changes.volume.newValue, DEFAULT_VOLUME);
    updateCachedVolume(volume);
    sendToOffscreen({ action: 'setVolume', volume });
  }

  if (isChanged(changes, 'speed', getCachedSpeed())) {
    const speed = toNumber(changes.speed.newValue, DEFAULT_SPEED);
    updateCachedSpeed(speed);
    sendToOffscreen({ action: 'setSpeed', speed });
    // 生成待ちキューの速度も揃える（popup の速度スライダーと同じ扱い）
    const updatedQueue = getState().commentQueue.map((comment) => ({ ...comment, speed }));
    updateState({ commentQueue: updatedQueue });
    void patchDomRecoveryConfig({ speed });
  }
}

// 最新N件モード（state 上のフラグ）
function applyLatestOnlyChanges(changes: Changes): void {
  const state = getState();

  if (isChanged(changes, 'latestOnlyMode', state.latestOnlyMode)) {
    const latestOnlyMode = Boolean(changes.latestOnlyMode.newValue);
    updateState({ latestOnlyMode });
    void patchDomRecoveryConfig({ latestOnlyMode });
  }

  if (isChanged(changes, 'latestOnlyCount', state.latestOnlyCount)) {
    const latestOnlyCount = toNumber(changes.latestOnlyCount.newValue, DEFAULT_LATEST_ONLY_COUNT);
    updateState({ latestOnlyCount });
    void patchDomRecoveryConfig({ latestOnlyCount });
  }
}

// TTSエンジン関連
function applyTtsEngineChanges(changes: Changes): void {
  if (isChanged(changes, 'ttsEngine', getTtsEngine())) {
    const raw = changes.ttsEngine.newValue as TtsEngine | undefined;
    const engine = raw && VALID_TTS_ENGINES.includes(raw) ? raw : DEFAULT_TTS_ENGINE;
    // 進行中の音声生成は旧エンジンのものなので破棄する
    cancelScheduledProcessing();
    incrementSessionId();
    setTtsEngine(engine);
    setSpeakerNameEngine(engine);
    logInfo(`設定変更を反映: TTSエンジン ${engine}`);
  }

  if (isChanged(changes, 'browserVoice', getBrowserVoice())) {
    setBrowserVoice((changes.browserVoice.newValue as string | undefined) ?? null);
  }

  if (isChanged(changes, 'localVoicevoxHost', getLocalVoicevoxHost())) {
    const host =
      (changes.localVoicevoxHost.newValue as string | undefined) || DEFAULT_LOCAL_VOICEVOX_HOST;
    setLocalVoicevoxHost(host);
  }

  // エンジン or ホストが変わったらローカル話者名キャッシュを取り直す
  if ('ttsEngine' in changes || 'localVoicevoxHost' in changes) {
    if (getTtsEngine() === 'local-voicevox') {
      initLocalSpeakerNames(getLocalVoicevoxHost());
    }
  }

  if (isChanged(changes, 'parallelSynthesisCount', getMaxParallelSynthesis())) {
    setMaxParallelSynthesis(
      toNumber(changes.parallelSynthesisCount.newValue, DEFAULT_PARALLEL_SYNTHESIS)
    );
  }
}

// オブジェクト形式の設定（storage から読み直してデフォルトとマージする）
function applyConfigObjectChanges(changes: Changes): void {
  if ('filterConfig' in changes) {
    void loadFilterConfigFromStorage();
  }
  if ('rushModeConfig' in changes) {
    loadRushConfigFromStorage();
    evaluateRushMode();
  }
  if ('randomSpeedConfig' in changes) {
    loadRandomSpeedConfigFromStorage();
  }
  if ('autoCatchUpConfig' in changes) {
    loadAutoCatchUpConfigFromStorage();
  }
  if ('parallelPlaybackConfig' in changes) {
    loadParallelPlaybackConfigFromStorage();
  }
  if ('parallelSpeakersConfig' in changes) {
    loadParallelSpeakersConfigFromStorage();
  }
}

/**
 * 実行中セッションの話者IDを storage の値へ揃える。
 * 使用するキーはエンジンによって異なるため、変更後の storage をまとめて読み直す。
 */
async function syncActiveSpeakerId(): Promise<void> {
  const data = await chrome.storage.sync.get(['ttsEngine', 'speakerId', 'localSpeakerId']);
  const engine = (data.ttsEngine as TtsEngine | undefined) ?? DEFAULT_TTS_ENGINE;
  const stored = engine === 'local-voicevox' ? data.localSpeakerId : data.speakerId;
  const speakerId = stripRandomSentinel(stored as string | undefined);

  updateStandaloneSpeakerId(speakerId);
  updatePollingSpeakerId(speakerId);
  await patchDomRecoveryConfig({ speakerId });
}

/** SW再起動時の復元用設定（session storage）にも変更を反映する */
async function patchDomRecoveryConfig(patch: Record<string, unknown>): Promise<void> {
  try {
    const data = await chrome.storage.session.get('domRecoveryConfig');
    const current = data.domRecoveryConfig as Record<string, unknown> | undefined;
    if (!current) return;
    await chrome.storage.session.set({ domRecoveryConfig: { ...current, ...patch } });
  } catch {
    // session storage が使えない場合は無視（復元用途のみ）
  }
}
