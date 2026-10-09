// Yahoo! JAPAN YOLP ジオコーダAPI クライアント（spec.md 3.5.5）

import type { FetchLike } from "../http";
import { defaultFetch } from "../http";
import { truncateName } from "./location";

export interface GeocodeResult {
  name: string;
  lat: number;
  lon: number;
}

/** 見つからなければ null。通信失敗・タイムアウトは例外 */
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
