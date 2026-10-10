// Yahoo! JAPAN YOLP ジオコーダAPI・リバースジオコーダAPI クライアント（spec.md 3.5.5）

import type { FetchLike } from "../http";
import { defaultFetch } from "../http";
import { truncateName } from "./location";

export interface GeocodeResult {
  name: string;
  lat: number;
  lon: number;
}

/** 地名 → 緯度経度。見つからなければ null。通信失敗・タイムアウトは例外 */
export async function geocode(
  query: string,
  appId: string,
  fetchImpl: FetchLike = defaultFetch,
  timeoutMs = 5000,
): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({ query, output: "json", results: "1", appid: appId });
  const res = await fetchImpl(`https://map.yahooapis.jp/geocode/V1/geoCoder?${params}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Yahoo ジオコーダAPI HTTP ${res.status}`);
  const json = (await res.json()) as any;

  if (!Number(json?.ResultInfo?.Count)) return null;
  const feature = json?.Feature?.[0];
  const [lon, lat] = String(feature?.Geometry?.Coordinates ?? "").split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { name: truncateName(feature?.Name || query), lat, lon };
}

/** 緯度経度 → 「都道府県＋市区町村」の名前。わからなければ null。通信失敗・タイムアウトは例外 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  appId: string,
  fetchImpl: FetchLike = defaultFetch,
  timeoutMs = 5000,
): Promise<string | null> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), output: "json", appid: appId });
  const res = await fetchImpl(`https://map.yahooapis.jp/geoapi/V1/reverseGeoCoder?${params}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Yahoo リバースジオコーダAPI HTTP ${res.status}`);
  const json = (await res.json()) as any;

  const elements: { Name?: string; Level?: string }[] = json?.Feature?.[0]?.Property?.AddressElement ?? [];
  const pick = (level: string) => elements.find((e) => e.Level === level)?.Name ?? "";
  const name = pick("prefecture") + pick("city");
  return name ? truncateName(name) : null;
}
