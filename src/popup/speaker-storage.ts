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
