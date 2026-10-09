// 傘の要否判定（spec.md 3.1.3）

export type UmbrellaLevel = "required" | "folding" | "none";

export interface HourlyForecast {
  /** Open-Meteo の時刻（例: 2026-10-10T07:00、JST） */
  time: string[];
  precipitationProbability: (number | null)[];
  precipitation: (number | null)[];
}

export interface UmbrellaThresholds {
  probRequired: number;
  probFolding: number;
  precipRequired: number;
  /** 降り始めの目安に使う1時間の降水量 */
  hourPrecip: number;
}

export interface UmbrellaResult {
  level: UmbrellaLevel;
  maxProb: number;
  totalPrecip: number;
  /** 雨の降り始めの目安（時）。傘不要のときは null */
  rainStartHour: number | null;
}

/** startHour 時 〜 endHour 時（endHour の時は含まない）の時間別予報で判定する */
export function judgeUmbrella(
  hourly: HourlyForecast,
  startHour: number,
  endHour: number,
  t: UmbrellaThresholds,
): UmbrellaResult {
  const hours: { hour: number; prob: number; precip: number }[] = [];
  for (let i = 0; i < hourly.time.length; i++) {
    const hour = Number(hourly.time[i].slice(11, 13));
    if (hour < startHour || hour >= endHour) continue;
    hours.push({
      hour,
      prob: hourly.precipitationProbability[i] ?? 0,
      precip: hourly.precipitation[i] ?? 0,
    });
  }

  const maxProb = hours.reduce((max, h) => Math.max(max, h.prob), 0);
  const totalPrecip = Math.round(hours.reduce((sum, h) => sum + h.precip, 0) * 10) / 10;

  if (maxProb >= t.probRequired || totalPrecip >= t.precipRequired) {
    const start = hours.find((h) => h.prob >= t.probRequired || h.precip >= t.hourPrecip);
    return { level: "required", maxProb, totalPrecip, rainStartHour: start?.hour ?? null };
  }
  if (maxProb >= t.probFolding) {
    const start = hours.find((h) => h.prob >= t.probFolding);
    return { level: "folding", maxProb, totalPrecip, rainStartHour: start?.hour ?? null };
  }
  return { level: "none", maxProb, totalPrecip, rainStartHour: null };
}
