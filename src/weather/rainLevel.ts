// 雨の強さ区分（気象庁の用語に準拠。spec.md 3.2.2）

export type RainLevel = "light" | "rain" | "moderate" | "heavy" | "intense";

const ORDER: RainLevel[] = ["light", "rain", "moderate", "heavy", "intense"];

export const RAIN_LEVEL_LABEL: Record<RainLevel, string> = {
  light: "弱い雨",
  rain: "雨",
  moderate: "やや強い雨",
  heavy: "強い雨",
  intense: "激しい雨（ゲリラ豪雨の恐れ）",
};

/** 降水強度（mm/h）を区分する。しきい値未満は「雨なし」として null */
export function classifyRain(mmPerHour: number, threshold: number): RainLevel | null {
  if (mmPerHour < threshold) return null;
  if (mmPerHour < 3) return "light";
  if (mmPerHour < 10) return "rain";
  if (mmPerHour < 20) return "moderate";
  if (mmPerHour < 30) return "heavy";
  return "intense";
}

/** 比較用の順位。雨なしは -1 */
export function levelRank(level: RainLevel | null): number {
  return level === null ? -1 : ORDER.indexOf(level);
}

/** 強調表示する区分（強い雨以上）か */
export function isSevere(level: RainLevel | null): boolean {
  return levelRank(level) >= levelRank("heavy");
}
