// 朝の天気通知（spec.md 3.1）

import { morningFailedMessage, morningMessage } from "../notify/messages";
import type { Services } from "../services";
import type { Location, Settings } from "../state";
import { setMorningFlag } from "../state";
import { formatDateJa, parseHm, toJst } from "../time";
import type { Forecast } from "../weather/openMeteo";
import { judgeUmbrella } from "../weather/umbrella";

const FORECAST_ATTEMPTS = 3;
const FORECAST_RETRY_WAIT_MS = 5000;

export type MorningResult = "sent" | "forecast-failed";

/** 地点が設定済みの利用者に朝の通知を送る（地点が未設定の利用者には送らない。FR-5-7） */
export async function runMorning(
  s: Services,
  userId: string,
  settings: Settings & { location: Location },
  nowMs: number,
): Promise<MorningResult> {
  const jst = toJst(nowMs);
  const location = settings.location;
  const forecast = await fetchWithRetry(s, location.lat, location.lon);

  let text: string;
  if (forecast) {
    const c = s.config;
    const startHour = Math.floor(parseHm(settings.morningTime) / 60);
    const umbrella = judgeUmbrella(forecast.hourly, startHour, c.umbrellaEndHour, {
      probRequired: c.umbrellaProbRequired,
      probFolding: c.umbrellaProbFolding,
      precipRequired: c.umbrellaPrecipRequired,
      hourPrecip: c.umbrellaHourPrecip,
    });
    text = morningMessage(location.name, formatDateJa(jst), forecast.daily, umbrella);
  } else {
    text = morningFailedMessage();
  }

  // 送信に失敗したら例外のまま抜け、送信済みフラグを立てない（30分の猶予内で次の実行が再送する）
  await s.line.push(userId, text);
  await setMorningFlag(s.kv, userId, jst.date, "sent");
  return forecast ? "sent" : "forecast-failed";
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
