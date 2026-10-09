import { DEFAULT_CONFIG } from "../src/config";
import type { Quota, LineApi } from "../src/notify/line";
import type { Services } from "../src/services";
import type { KvStore, Settings } from "../src/state";
import { jstToMs } from "../src/time";
import type { Forecast } from "../src/weather/openMeteo";
import type { Nowcast } from "../src/weather/yahoo";

export class MemoryKv implements KvStore {
  data = new Map<string, string>();
  writes = 0;
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.writes++;
    this.data.set(key, value);
  }
  async delete(key: string) {
    this.data.delete(key);
  }
}

export class FakeLine implements LineApi {
  pushes: string[] = [];
  replies: { token: string; text: string }[] = [];
  quota: Quota | null = { limit: 200, used: 0 };
  failPush = false;
  async push(text: string) {
    if (this.failPush) throw new Error("push failed");
    this.pushes.push(text);
  }
  async reply(token: string, text: string) {
    this.replies.push({ token, text });
  }
  async getQuota() {
    return this.quota;
  }
}

export const TOKYO: Settings["location"] = { name: "東京都渋谷区", lat: 35.664, lon: 139.698, source: "geocode" };

export function makeServices(overrides: Partial<Services> = {}): Services & { kv: MemoryKv; line: FakeLine } {
  return {
    kv: new MemoryKv(),
    config: { ...DEFAULT_CONFIG },
    line: new FakeLine(),
    userId: "Uowner",
    channelSecret: "secret",
    fetchForecast: async () => sampleForecast(),
    fetchNowcast: async () => nowcast(0, [0, 0, 0, 0, 0, 0]),
    geocode: async () => null,
    sleep: async () => {},
    ...overrides,
  } as Services & { kv: MemoryKv; line: FakeLine };
}

export async function storeSettings(kv: KvStore, settings: Partial<Settings>) {
  await kv.put(
    "settings",
    JSON.stringify({ location: TOKYO, morningTime: "07:00", rainHours: { start: 6, end: 23 }, ...settings }),
  );
}

/** 2026-10-10（土）の JST 時刻 */
export function at(hour: number, minute = 0, day = 10): number {
  return jstToMs(2026, 10, day, hour, minute);
}

export function sampleForecast(probs: number[] = Array(24).fill(0), precips: number[] = Array(24).fill(0)): Forecast {
  return {
    daily: { weatherCode: 1, tempMax: 24.4, tempMin: 15.6, precipProbMax: Math.max(...probs) },
    hourly: {
      time: Array.from({ length: 24 }, (_, h) => `2026-10-10T${String(h).padStart(2, "0")}:00`),
      precipitationProbability: probs,
      precipitation: precips,
    },
  };
}

/** 観測値と 10〜60分後の予測値から Nowcast を作る（基準は 14:00） */
export function nowcast(observed: number, forecasts: number[], baseMs = at(14)): Nowcast {
  return {
    observation: { time: baseMs, rainfall: observed },
    forecasts: forecasts.map((rainfall, i) => ({ time: baseMs + (i + 1) * 10 * 60_000, rainfall })),
  };
}
