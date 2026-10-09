// Open-Meteo Forecast API クライアント（spec.md 3.1.2）

import type { FetchLike } from "../http";
import { defaultFetch } from "../http";
import type { HourlyForecast } from "./umbrella";

export interface DailyForecast {
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  precipProbMax: number | null;
}

export interface Forecast {
  daily: DailyForecast;
  hourly: HourlyForecast;
}

export async function fetchForecast(lat: number, lon: number, fetchImpl: FetchLike = defaultFetch): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
    hourly: "precipitation_probability,precipitation",
    timezone: "Asia/Tokyo",
    forecast_days: "1",
  });
  const res = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = (await res.json()) as any;

  const daily = json?.daily;
  const hourly = json?.hourly;
  if (!daily || !hourly || !Array.isArray(hourly.time)) {
    throw new Error("Open-Meteo: 想定外のレスポンス");
  }
  return {
    daily: {
      weatherCode: daily.weather_code?.[0],
      tempMax: daily.temperature_2m_max?.[0],
      tempMin: daily.temperature_2m_min?.[0],
      precipProbMax: daily.precipitation_probability_max?.[0] ?? null,
    },
    hourly: {
      time: hourly.time,
      precipitationProbability: hourly.precipitation_probability ?? [],
      precipitation: hourly.precipitation ?? [],
    },
  };
}
