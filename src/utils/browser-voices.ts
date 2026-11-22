/**
 * ランダム話者の許可リストが未設定のときに使うブラウザ音声の既定候補を返す。
 * 外国語の音声は日本語をまともに読めないため日本語音声だけにする。
 * 日本語音声が1つもない環境では、読み上げ自体ができなくならないよう全音声を使う。
 */
export function getDefaultBrowserVoiceNames(
  voices: Array<{ voiceName?: string; lang?: string }>,
): string[] {
  const named = voices.filter((v) => v.voiceName);
  const ja = named.filter((v) => v.lang?.startsWith('ja'));
  return (ja.length > 0 ? ja : named).map((v) => v.voiceName!);
}
