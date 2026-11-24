import type { ParallelSpeakersConfig, RoundRobinPreset, TtsEngine } from '@/types/state';

type EngineKey = keyof NonNullable<ParallelSpeakersConfig['speakerIdsByEngine']>;

/** 持ち回り制に対応するエンジンの保存キー。ブラウザ内蔵音声は非対応のため null */
function getEngineKey(engine: TtsEngine): EngineKey | null {
  if (engine === 'voicevox') return 'voicevox';
  if (engine === 'local-voicevox') return 'localVoicevox';
  return null;
}

/** 持ち回り制（話者の割り当て）に対応するエンジンか */
export function isRoundRobinSupportedEngine(engine: TtsEngine): boolean {
  return getEngineKey(engine) !== null;
}

/**
 * 指定エンジンで使う持ち回り話者IDを返す。
 * エンジン別の値が未保存なら旧形式（エンジン共通）の speakerIds を使う。
 * 旧データは Web API・ローカルの両方にコピーしたのと同じ扱いになる。
 */
export function getSpeakerIdsForEngine(
  config: Partial<ParallelSpeakersConfig> | undefined,
  engine: TtsEngine,
): string[] {
  const key = getEngineKey(engine);
  if (!key || !config) return [];
  return config.speakerIdsByEngine?.[key] ?? config.speakerIds ?? [];
}

/**
 * 指定エンジンの持ち回り話者IDを差し替えた設定を返す（元の設定は変更しない）。
 * もう一方のエンジンがまだ旧形式のままなら、その時点の旧データをそのエンジン用として確定させる
 * （この保存で speakerIds を上書きしても、もう一方の設定が変わらないようにするため）。
 */
export function withSpeakerIdsForEngine(
  config: ParallelSpeakersConfig,
  engine: TtsEngine,
  speakerIds: string[],
): ParallelSpeakersConfig {
  const key = getEngineKey(engine);
  if (!key) return config;
  const legacy = config.speakerIds ?? [];
  const byEngine = config.speakerIdsByEngine ?? {};
  return {
    ...config,
    speakerIds,
    speakerIdsByEngine: {
      voicevox: byEngine.voicevox ?? legacy,
      localVoicevox: byEngine.localVoicevox ?? legacy,
      [key]: speakerIds,
    },
  };
}

/**
 * プリセットが指定エンジンで使えるか。
 * engine 付き（新形式）はそのエンジンのみ。旧形式は VOICEVOX 系（Web API・ローカル）の両方で使える。
 * ブラウザ内蔵音声は持ち回り制に非対応のため、どのプリセットも使えない。
 */
export function isRoundRobinPresetApplicable(preset: RoundRobinPreset, engine: TtsEngine): boolean {
  if (!isRoundRobinSupportedEngine(engine)) return false;
  if (preset.engine) return preset.engine === engine;
  return true;
}

/**
 * 現在の話者数・話者2以降の割り当てがプリセットと一致するか（「適用中」表示用）。
 * 話者1はメインの話者設定のためプリセットに含まれず、比較しない。
 * プリセット側の未設定（短い配列）は空として扱う。
 */
export function isRoundRobinPresetActive(
  preset: RoundRobinPreset,
  engine: TtsEngine,
  speakerCount: number,
  speakerIds: string[],
): boolean {
  if (!isRoundRobinPresetApplicable(preset, engine)) return false;
  if (preset.roundRobinSpeakerCount !== speakerCount) return false;
  const slots = Math.max(0, speakerCount - 1);
  for (let i = 0; i < slots; i++) {
    if ((preset.speakerIds[i] ?? '') !== (speakerIds[i] ?? '')) return false;
  }
  return true;
}
