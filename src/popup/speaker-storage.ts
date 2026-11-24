import { RANDOM_SPEAKER_SENTINEL } from '@/types/state';

/**
 * 再生開始時に保存する「選択中の話者」の storage パッチを返す。
 *
 * - 話者IDの保存先はエンジンごとに異なる（Web API: speakerId / ローカル: localSpeakerId）。
 *   以前はローカルVOICEVOXでも speakerId に書いており、Web API 側の話者選択が
 *   ローカルのスタイルIDで上書きされていた。
 * - ランダム話者モード中はドロップダウンがダミー値なので保存しない
 *   （保存すると先頭の話者でユーザーの選択を上書きしてしまう）。
 * - ブラウザ内蔵音声の音声名は browserVoice の change で保存済みのため対象外。
 */
export function buildSpeakerStoragePatch(
  engine: string,
  selectedValue: string
): Record<string, string> {
  if (!selectedValue || selectedValue === RANDOM_SPEAKER_SENTINEL) return {};
  if (engine === 'local-voicevox') return { localSpeakerId: selectedValue };
  if (engine === 'voicevox') return { speakerId: selectedValue };
  return {};
}

/** 現在のエンジンで話者選択に使うドロップダウンの id */
export function getSpeakerSelectId(engine: string): string {
  if (engine === 'local-voicevox') return 'localSpeaker';
  if (engine === 'browser') return 'browserVoice';
  return 'speaker';
}

/**
 * 別ページ（持ち回り制の話者設定など）でメインの話者が変わったとき、ポップアップの選択に反映する。
 * ポップアップをタブで開いたままだと古い選択が残り、再生開始時に古い値で上書きしてしまうため。
 * ランダムモード中はダミー選択のまま、OFF に戻したときの復帰先（realValue）だけ差し替える。
 */
export function applyExternalSpeakerChange(select: HTMLSelectElement, newValue: unknown): void {
  if (typeof newValue !== 'string' || !newValue || newValue === RANDOM_SPEAKER_SENTINEL) return;
  if (!Array.from(select.options).some((o) => o.value === newValue)) return;
  if (select.value === RANDOM_SPEAKER_SENTINEL) {
    select.dataset.realValue = newValue;
    return;
  }
  if (select.value !== newValue) select.value = newValue;
}
