// 朝の天気通知（spec.md 3.1）

import { morningFailedMessage, morningMessage, setupNeededMessage } from "../notify/messages";
import type { Services } from "../services";
import type { Settings } from "../state";
import { setMorningFlag } from "../state";
import type { JstTime } from "../time";
import { formatDateJa, parseHm, toJst } from "../time";
import type { Forecast } from "../weather/openMeteo";
import { judgeUmbrella } from "../weather/umbrella";

const FORECAST_ATTEMPTS = 3;
const FORECAST_RETRY_WAIT_MS = 5000;

export type MorningResult = "sent" | "setup-needed" | "forecast-failed";

export async function runMorning(s: Services, settings: Settings, nowMs: number): Promise<MorningResult> {
  const jst = toJst(nowMs);
  const { text, result } = await buildMorningText(s, settings, jst);
  // 送信に失敗したら例外のまま抜け、送信済みフラグを立てない（30分の猶予内で次の実行が再送する）
  await s.line.push(text);
  await setMorningFlag(s.kv, jst.date, "sent");
  return result;
}

async function buildMorningText(
  s: Services,
  settings: Settings,
  jst: JstTime,
): Promise<{ text: string; result: MorningResult }> {
  const location = settings.location;
  if (!location) return { text: setupNeededMessage(), result: "setup-needed" };

  const forecast = await fetchWithRetry(s, location.lat, location.lon);
  if (!forecast) return { text: morningFailedMessage(), result: "forecast-failed" };

  const c = s.config;
  const startHour = Math.floor(parseHm(settings.morningTime) / 60);
  const umbrella = judgeUmbrella(forecast.hourly, startHour, c.umbrellaEndHour, {
    probRequired: c.umbrellaProbRequired,
    probFolding: c.umbrellaProbFolding,
    precipRequired: c.umbrellaPrecipRequired,
    hourPrecip: c.umbrellaHourPrecip,
  });
  return { text: morningMessage(location.name, formatDateJa(jst), forecast.daily, umbrella), result: "sent" };
}

async function fetchWithRetry(s: Services, lat: number, lon: number): Promise<Forecast | null> {
  for (let attempt = 1; attempt <= FORECAST_ATTEMPTS; attempt++) {
    try {
      return await s.fetchForecast(lat, lon);
    } catch (e) {
      console.error(`morning: 天気予報の取得に失敗（${attempt}/${FORECAST_ATTEMPTS}）`, e);
      if (attempt < FORECAST_ATTEMPTS) await s.sleep(FORECAST_RETRY_WAIT_MS);
    }
  }
  return null;
}
