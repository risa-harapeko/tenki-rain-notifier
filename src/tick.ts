// 10分ごとの振り分け（spec.md 3.0）

import { MORNING_GRACE_MIN } from "./commands/schedule";
import { runMorning } from "./jobs/morning";
import { runRainAlert } from "./jobs/rainAlert";
import type { Services } from "./services";
import type { MorningFlag, Settings } from "./state";
import { getMorningFlag, getSettings } from "./state";
import type { JstTime } from "./time";
import { formatClock, parseHm, toJst } from "./time";

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

export function planTick(settings: Settings, morningFlag: MorningFlag | null, jst: JstTime): TickPlan {
  return {
    morning: isInMorningWindow(settings, jst) && morningFlag === null,
    rain: settings.location !== null && isInRainHours(settings, jst),
  };
}

export async function runTick(s: Services, scheduledTime: number): Promise<void> {
  const jst = toJst(scheduledTime);
  const settings = await getSettings(s.kv, s.config);
  // 送信済みフラグは朝の時間枠のときだけ読む（KV の読み取りを減らす）
  const flag = isInMorningWindow(settings, jst) ? await getMorningFlag(s.kv, jst.date) : null;
  const plan = planTick(settings, flag, jst);

  const log = [`tick ${jst.date} ${formatClock(jst.minutesOfDay)}`];
  if (plan.morning) {
    try {
      log.push(`morning=${await runMorning(s, settings, scheduledTime)}`);
    } catch (e) {
      log.push("morning=error");
      console.error("tick: 朝の通知でエラー", e);
    }
  }
  if (plan.rain) {
    try {
      const r = await runRainAlert(s, settings, scheduledTime);
      log.push(`rain=${r.action}${r.sent ? "(sent)" : ""} now=${r.nowRain} peak=${r.peak}`);
    } catch (e) {
      log.push("rain=error");
      console.error("tick: 急な雨チェックでエラー", e);
    }
  }
  if (!plan.morning && !plan.rain) log.push("idle");
  console.log(log.join(" "));
}
