// Workers KV の読み書き（spec.md 4章）

import type { Config } from "./config";
import type { RainHours } from "./commands/schedule";
import { isValidRainHours, parseMorningTime } from "./commands/schedule";
import type { RainLevel } from "./weather/rainLevel";
import { toJstIso } from "./time";

/** テストでも差し替えられるよう、KVNamespace のうち使う部分だけを型にする */
export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Location {
  name: string;
  lat: number;
  lon: number;
  source: "location" | "geocode";
}

export interface Settings {
  location: Location | null;
  /** "HH:MM" */
  morningTime: string;
  rainHours: RainHours;
  updatedAt?: string;
}

export type MorningFlag = "sent" | "skipped";

export interface RainState {
  count: number;
  raining: boolean;
  lastNotifiedAt: string | null;
  lastLevel: RainLevel | null;
}

const SETTINGS_KEY = "settings";
const DAILY_TTL_SEC = 2 * 24 * 60 * 60;

export const INITIAL_RAIN_STATE: RainState = { count: 0, raining: false, lastNotifiedAt: null, lastLevel: null };

export function defaultSettings(config: Config): Settings {
  return { location: null, morningTime: config.defaultMorningTime, rainHours: { ...config.defaultRainHours } };
}

function isValidLocation(v: any): v is Location {
  return (
    v != null &&
    typeof v.name === "string" &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lon) &&
    (v.source === "location" || v.source === "geocode")
  );
}

/** 保存値が無い・壊れている項目は初期値で補う */
export async function getSettings(kv: KvStore, config: Config): Promise<Settings> {
  const defaults = defaultSettings(config);
  const raw = await kv.get(SETTINGS_KEY);
  if (!raw) return defaults;
  try {
    const p = JSON.parse(raw);
    return {
      location: isValidLocation(p.location) ? p.location : null,
      morningTime:
        typeof p.morningTime === "string" && parseMorningTime(p.morningTime).ok ? p.morningTime : defaults.morningTime,
      rainHours: p.rainHours && isValidRainHours(p.rainHours) ? p.rainHours : defaults.rainHours,
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : undefined,
    };
  } catch (e) {
    console.error("state: settings の読み込みに失敗したため初期値を使います", e);
    return defaults;
  }
}

export async function saveSettings(kv: KvStore, settings: Settings, nowMs: number): Promise<void> {
  await kv.put(SETTINGS_KEY, JSON.stringify({ ...settings, updatedAt: toJstIso(nowMs) }));
}

export async function getMorningFlag(kv: KvStore, date: string): Promise<MorningFlag | null> {
  const v = await kv.get(`morning:${date}`);
  return v === "sent" || v === "skipped" ? v : null;
}

export async function setMorningFlag(kv: KvStore, date: string, flag: MorningFlag): Promise<void> {
  await kv.put(`morning:${date}`, flag, { expirationTtl: DAILY_TTL_SEC });
}

export async function clearMorningFlag(kv: KvStore, date: string): Promise<void> {
  await kv.delete(`morning:${date}`);
}

export async function getRainState(kv: KvStore, date: string): Promise<RainState> {
  const raw = await kv.get(`rain:${date}`);
  if (!raw) return { ...INITIAL_RAIN_STATE };
  try {
    return { ...INITIAL_RAIN_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...INITIAL_RAIN_STATE };
  }
}

export async function saveRainState(kv: KvStore, date: string, state: RainState): Promise<void> {
  await kv.put(`rain:${date}`, JSON.stringify(state), { expirationTtl: DAILY_TTL_SEC });
}
