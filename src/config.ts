// 環境変数の読み込み（spec.md 5.1 / 5.2）

import type { RainHours } from "./commands/schedule";
import { parseMorningTime, parseRainHours, toStoredTime } from "./commands/schedule";

export interface Env {
  STATE: KVNamespace;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  LINE_USER_ID: string;
  YAHOO_APP_ID: string;
  DEFAULT_MORNING_TIME?: string;
  DEFAULT_RAIN_HOURS?: string;
  UMBRELLA_END_HOUR?: string;
  UMBRELLA_PROB_REQUIRED?: string;
  UMBRELLA_PROB_FOLDING?: string;
  UMBRELLA_PRECIP_REQUIRED?: string;
  RAIN_THRESHOLD?: string;
  MAX_ALERTS_PER_DAY?: string;
  ALERT_COOLDOWN_MIN?: string;
}

export interface Config {
  /** "HH:MM" */
  defaultMorningTime: string;
  defaultRainHours: RainHours;
  umbrellaEndHour: number;
  umbrellaProbRequired: number;
  umbrellaProbFolding: number;
  umbrellaPrecipRequired: number;
  /** 降り始めの目安に使う1時間の降水量（mm） */
  umbrellaHourPrecip: number;
  rainThreshold: number;
  maxAlertsPerDay: number;
  alertCooldownMin: number;
}

export const DEFAULT_CONFIG: Config = {
  defaultMorningTime: "07:00",
  defaultRainHours: { start: 6, end: 23 },
  umbrellaEndHour: 22,
  umbrellaProbRequired: 50,
  umbrellaProbFolding: 30,
  umbrellaPrecipRequired: 1.0,
  umbrellaHourPrecip: 0.5,
  rainThreshold: 1.0,
  maxAlertsPerDay: 3,
  alertCooldownMin: 60,
};

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: Env): Config {
  const d = DEFAULT_CONFIG;

  let defaultMorningTime = d.defaultMorningTime;
  if (env.DEFAULT_MORNING_TIME) {
    const parsed = parseMorningTime(env.DEFAULT_MORNING_TIME);
    if (parsed.ok) defaultMorningTime = toStoredTime(parsed.value);
    else console.error(`config: DEFAULT_MORNING_TIME が不正なため ${d.defaultMorningTime} を使います`);
  }

  let defaultRainHours = d.defaultRainHours;
  if (env.DEFAULT_RAIN_HOURS) {
    const parsed = parseRainHours(env.DEFAULT_RAIN_HOURS);
    if (parsed.ok) defaultRainHours = parsed.value;
    else console.error("config: DEFAULT_RAIN_HOURS が不正なため 6-23 を使います");
  }

  return {
    defaultMorningTime,
    defaultRainHours,
    umbrellaEndHour: num(env.UMBRELLA_END_HOUR, d.umbrellaEndHour),
    umbrellaProbRequired: num(env.UMBRELLA_PROB_REQUIRED, d.umbrellaProbRequired),
    umbrellaProbFolding: num(env.UMBRELLA_PROB_FOLDING, d.umbrellaProbFolding),
    umbrellaPrecipRequired: num(env.UMBRELLA_PRECIP_REQUIRED, d.umbrellaPrecipRequired),
    umbrellaHourPrecip: d.umbrellaHourPrecip,
    rainThreshold: num(env.RAIN_THRESHOLD, d.rainThreshold),
    maxAlertsPerDay: num(env.MAX_ALERTS_PER_DAY, d.maxAlertsPerDay),
    alertCooldownMin: num(env.ALERT_COOLDOWN_MIN, d.alertCooldownMin),
  };
}
