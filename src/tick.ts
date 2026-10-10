// 10分ごとの振り分け（spec.md 3.0）。登録済みの利用者ごとに朝の通知・急な雨のチェックを行う

import { MORNING_GRACE_MIN } from "./commands/schedule";
import { runMorning } from "./jobs/morning";
import { runRainAlert } from "./jobs/rainAlert";
import type { Services } from "./services";
import type { Location, MorningFlag, Settings } from "./state";
import { getMorningFlag, getSettings, getUsers, migrateLegacyData } from "./state";
import type { JstTime } from "./time";
import { formatClock, parseHm, toJst } from "./time";
import type { Nowcast } from "./weather/yahoo";

/** 朝の通知を送る時間枠（設定時刻 〜 +30分）に入っているか */
export function isInMorningWindow(settings: Settings, jst: JstTime): boolean {
  const at = parseHm(settings.morningTime);
  return jst.minutesOfDay >= at && jst.minutesOfDay < at + MORNING_GRACE_MIN;
}

export function isInRainHours(settings: Settings, jst: JstTime): boolean {
  return jst.hour >= settings.rainHours.start && jst.hour < settings.rainHours.end;
}

export interface TickPlan {
  morning: boolean;
  rain: boolean;
}

/** 地点が未設定の利用者には、朝の通知・急な雨の通知のどちらも送らない（FR-5-7） */
export function planTick(settings: Settings, morningFlag: MorningFlag | null, jst: JstTime): TickPlan {
  const hasLocation = settings.location !== null;
  return {
    morning: hasLocation && isInMorningWindow(settings, jst) && morningFlag === null,
    rain: hasLocation && isInRainHours(settings, jst),
  };
}

/** 同じ（丸めた）地点の利用者が複数いても、雨雲の予測は1回だけ取得する */
function withNowcastCache(s: Services): Services {
  const cache = new Map<string, Promise<Nowcast>>();
  return {
    ...s,
    fetchNowcast: (lat, lon) => {
      const key = `${lat},${lon}`;
      let p = cache.get(key);
      if (!p) {
        p = s.fetchNowcast(lat, lon);
        cache.set(key, p);
      }
      return p;
    },
  };
}

export async function runTick(s: Services, scheduledTime: number): Promise<void> {
  const jst = toJst(scheduledTime);
  await migrateLegacyData(s.kv, s.ownerId, jst.date);
  const users = await getUsers(s.kv, s.ownerId);
  const cached = withNowcastCache(s);

  for (const [i, userId] of users.entries()) {
    // ログには LINE ユーザーID を出さず、何人目かだけを書く
    await runUserTick(cached, userId, `user${i + 1}`, users.length, scheduledTime, jst);
  }
}

async function runUserTick(
  s: Services,
  userId: string,
  label: string,
  userCount: number,
  scheduledTime: number,
  jst: JstTime,
): Promise<void> {
  const settings = await getSettings(s.kv, s.config, userId);
  // 送信済みフラグは朝の時間枠のときだけ読む（KV の読み取りを減らす）
  const flag =
    settings.location && isInMorningWindow(settings, jst) ? await getMorningFlag(s.kv, userId, jst.date) : null;
  const plan = planTick(settings, flag, jst);

  const log = [`tick ${jst.date} ${formatClock(jst.minutesOfDay)} ${label}`];
  if (plan.morning) {
    try {
      log.push(`morning=${await runMorning(s, userId, settings as Settings & { location: Location }, scheduledTime)}`);
    } catch (e) {
      log.push("morning=error");
      console.error("tick: 朝の通知でエラー", e);
    }
  }
  if (plan.rain) {
    try {
      const r = await runRainAlert(s, userId, settings, scheduledTime, userCount);
      log.push(`rain=${r.action}${r.sent ? "(sent)" : ""} now=${r.nowRain} peak=${r.peak}`);
    } catch (e) {
      log.push("rain=error");
      console.error("tick: 急な雨チェックでエラー", e);
    }
  }
  if (!plan.morning && !plan.rain) log.push(settings.location ? "idle" : "idle(no-location)");
  console.log(log.join(" "));
}
