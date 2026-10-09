// Yahoo! JAPAN YOLP 気象情報API クライアント（spec.md 3.2.1）

import type { FetchLike } from "../http";
import { defaultFetch } from "../http";
import { parseYahooDate } from "../time";

export interface RainPoint {
  /** epoch ミリ秒 */
  time: number;
  /** 降水強度（mm/h） */
  rainfall: number;
}

export interface Nowcast {
  observation: RainPoint;
  /** 10〜60分後の予測（時刻順） */
  forecasts: RainPoint[];
}

export async function fetchNowcast(
  lat: number,
  lon: number,
  appId: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<Nowcast> {
  const params = new URLSearchParams({
    coordinates: `${lon},${lat}`, // 経度,緯度 の順
    output: "json",
    interval: "10",
    appid: appId,
  });
  const res = await fetchImpl(`https://map.yahooapis.jp/weather/V1/place?${params}`);
  if (!res.ok) throw new Error(`Yahoo 気象情報API HTTP ${res.status}`);
  const json = (await res.json()) as any;
  const list = json?.Feature?.[0]?.Property?.WeatherList?.Weather;
  if (!Array.isArray(list)) throw new Error("Yahoo 気象情報API: 想定外のレスポンス");
  return parseWeatherList(list);
}

export function parseWeatherList(list: { Type: string; Date: string; Rainfall: number | string }[]): Nowcast {
  const points = list.map((w) => ({
    type: w.Type,
    time: parseYahooDate(String(w.Date)),
    rainfall: Number(w.Rainfall) || 0,
  }));
  const observations = points.filter((p) => p.type === "observation").sort((a, b) => a.time - b.time);
  const forecasts = points.filter((p) => p.type === "forecast").sort((a, b) => a.time - b.time);
  const latest = observations.at(-1);
  if (!latest) throw new Error("Yahoo 気象情報API: 観測値がありません");
  return {
    observation: { time: latest.time, rainfall: latest.rainfall },
    forecasts: forecasts.map((p) => ({ time: p.time, rainfall: p.rainfall })),
  };
}
