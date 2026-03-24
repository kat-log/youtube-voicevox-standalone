export interface ParsedSpeaker {
  id: string;
  character: string;
  style: string;
  fullName: string;
}

/**
 * Web VOICEVOX の話者名（例: "ずんだもん（ノーマル）"）をキャラ名+スタイルに分解する。
 */
export function parseSpeakerName(id: string, fullName: string): ParsedSpeaker {
  const match = fullName.match(/^(.+?)（(.+?)）$/);
  if (match) {
    return { id, character: match[1], style: match[2], fullName };
  }
  return { id, character: fullName, style: '', fullName };
}

/**
 * ローカル VOICEVOX の構造化データから ParsedSpeaker 配列を生成する。
 */
export function parseLocalSpeakers(
  speakers: Array<{ name: string; styles: Array<{ id: number; name: string }> }>
): ParsedSpeaker[] {
  return speakers.flatMap((speaker) =>
    speaker.styles.map((style) => ({
      id: String(style.id),
      character: speaker.name,
      style: style.name,
      fullName: `${speaker.name}（${style.name}）`,
    }))
  );
}

/**
 * キャラクター名でグループ化する。Map の挿入順序を保持。
 */
export function groupByCharacter(speakers: ParsedSpeaker[]): Map<string, ParsedSpeaker[]> {
  const groups = new Map<string, ParsedSpeaker[]>();
  for (const s of speakers) {
    const arr = groups.get(s.character) || [];
    arr.push(s);
    groups.set(s.character, arr);
  }
  return groups;
}

/**
 * 全話者からユニークなスタイル名を抽出する。
 */
export function getUniqueStyles(speakers: ParsedSpeaker[]): string[] {
  const styles = new Set<string>();
  for (const s of speakers) {
    if (s.style) styles.add(s.style);
  }
  return Array.from(styles).sort();
}
