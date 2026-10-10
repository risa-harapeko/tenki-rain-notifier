// Workers KV の読み書き（spec.md 4章）。設定・状態は利用者（LINE ユーザーID）ごとに分けて保存する

import type { Config } from "./config";
import type { RainHours } from "./commands/schedule";
import { roundCoord } from "./commands/location";
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

const USERS_KEY = "users";
const DAILY_TTL_SEC = 2 * 24 * 60 * 60;

const settingsKey = (userId: string) => `settings:${userId}`;
const morningKey = (userId: string, date: string) => `morning:${userId}:${date}`;
const rainKey = (userId: string, date: string) => `rain:${userId}:${date}`;

export const INITIAL_RAIN_STATE: RainState = { count: 0, raining: false, lastNotifiedAt: null, lastLevel: null };

// ---- 利用者 ----

/** 登録済みの利用者。管理者（ownerId）は登録の操作なしで常に先頭に含める */
export async function getUsers(kv: KvStore, ownerId: string): Promise<string[]> {
  let stored: string[] = [];
  const raw = await kv.get(USERS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) stored = parsed.filter((v): v is string => typeof v === "string");
    } catch (e) {
      console.error(`state: users の読み込みに失敗（${(e as Error).name}）`);
    }
  }
  return [ownerId, ...stored.filter((id) => id !== ownerId)];
}

export async function addUser(kv: KvStore, ownerId: string, userId: string): Promise<void> {
  const others = (await getUsers(kv, ownerId)).filter((id) => id !== ownerId);
  if (others.includes(userId) || userId === ownerId) return;
  await kv.put(USERS_KEY, JSON.stringify([...others, userId]));
}

export async function removeUser(kv: KvStore, ownerId: string, userId: string): Promise<void> {
  const others = (await getUsers(kv, ownerId)).filter((id) => id !== ownerId);
  if (!others.includes(userId)) return;
  await kv.put(USERS_KEY, JSON.stringify(others.filter((id) => id !== userId)));
}

// ---- 設定 ----

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
export async function getSettings(kv: KvStore, config: Config, userId: string): Promise<Settings> {
  const defaults = defaultSettings(config);
  const raw = await kv.get(settingsKey(userId));
  if (!raw) return defaults;
  try {
    const p = JSON.parse(raw);
    return {
      // 以前の形式で詳しい位置が保存されていても、丸めた値だけを使う
      location: isValidLocation(p.location)
        ? { ...p.location, lat: roundCoord(p.location.lat), lon: roundCoord(p.location.lon) }
        : null,
      morningTime:
        typeof p.morningTime === "string" && parseMorningTime(p.morningTime).ok ? p.morningTime : defaults.morningTime,
      rainHours: p.rainHours && isValidRainHours(p.rainHours) ? p.rainHours : defaults.rainHours,
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : undefined,
    };
  } catch (e) {
    // JSON の解析エラーには保存値の一部（地名など）が含まれるため、エラーの種類だけを書く
    console.error(`state: settings の読み込みに失敗したため初期値を使います（${(e as Error).name}）`);
    return defaults;
  }
}

export async function saveSettings(kv: KvStore, userId: string, settings: Settings, nowMs: number): Promise<void> {
  await kv.put(settingsKey(userId), JSON.stringify({ ...settings, updatedAt: toJstIso(nowMs) }));
}

export async function deleteSettings(kv: KvStore, userId: string): Promise<void> {
  await kv.delete(settingsKey(userId));
}

// ---- 朝の送信済みフラグ ----

export async function getMorningFlag(kv: KvStore, userId: string, date: string): Promise<MorningFlag | null> {
  const v = await kv.get(morningKey(userId, date));
  return v === "sent" || v === "skipped" ? v : null;
}

export async function setMorningFlag(kv: KvStore, userId: string, date: string, flag: MorningFlag): Promise<void> {
  await kv.put(morningKey(userId, date), flag, { expirationTtl: DAILY_TTL_SEC });
}

export async function clearMorningFlag(kv: KvStore, userId: string, date: string): Promise<void> {
  await kv.delete(morningKey(userId, date));
}

// ---- 急な雨の状態 ----

export async function getRainState(kv: KvStore, userId: string, date: string): Promise<RainState> {
  const raw = await kv.get(rainKey(userId, date));
  if (!raw) return { ...INITIAL_RAIN_STATE };
  try {
    return { ...INITIAL_RAIN_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...INITIAL_RAIN_STATE };
  }
}

export async function saveRainState(kv: KvStore, userId: string, date: string, state: RainState): Promise<void> {
  await kv.put(rainKey(userId, date), JSON.stringify(state), { expirationTtl: DAILY_TTL_SEC });
}

// ---- 1人用の形式からの移行 ----

/**
 * 1人用だった頃のキー（settings / morning:{日付} / rain:{日付}）を管理者のキーへ移す。
 * 移行済みなら KV の読み取り1回だけで終わる。
 */
export async function migrateLegacyData(kv: KvStore, ownerId: string, date: string): Promise<void> {
  const legacySettings = await kv.get("settings");
  if (legacySettings === null) return;
  if ((await kv.get(settingsKey(ownerId))) === null) await kv.put(settingsKey(ownerId), legacySettings);

  const legacyMorning = await kv.get(`morning:${date}`);
  if (legacyMorning !== null) {
    await kv.put(morningKey(ownerId, date), legacyMorning, { expirationTtl: DAILY_TTL_SEC });
    await kv.delete(`morning:${date}`);
  }
  const legacyRain = await kv.get(`rain:${date}`);
  if (legacyRain !== null) {
    await kv.put(rainKey(ownerId, date), legacyRain, { expirationTtl: DAILY_TTL_SEC });
    await kv.delete(`rain:${date}`);
  }
  await kv.delete("settings");
  console.log("state: 1人用の形式のデータを管理者のデータとして移行しました");
}
