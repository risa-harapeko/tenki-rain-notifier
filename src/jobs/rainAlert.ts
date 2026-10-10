// 急な雨の通知（spec.md 3.2 / 3.4）

import type { LineApi } from "../notify/line";
import { rainAlertMessage } from "../notify/messages";
import type { Services } from "../services";
import type { RainState, Settings } from "../state";
import { getRainState, saveRainState } from "../state";
import type { JstTime } from "../time";
import { daysInMonth, toJst, toJstIso } from "../time";
import type { RainLevel } from "../weather/rainLevel";
import { classifyRain, isSevere } from "../weather/rainLevel";
import type { Nowcast, RainPoint } from "../weather/yahoo";

export interface RainRules {
  rainThreshold: number;
  maxAlertsPerDay: number;
  alertCooldownMin: number;
}

export interface RainDecision {
  action: "none" | "notify" | "escalate";
  /** 通知しなかった場合に保存する状態（雨の終了・降雨中の記録のみ反映） */
  base: RainState;
  /** 通知した場合に保存する状態 */
  next: RainState;
  onset: RainPoint | null;
  nowRain: number;
  peak: number;
  peakLevel: RainLevel | null;
}

/** 今回の実行で通知するかを決める（純粋関数。spec.md 3.2.3） */
export function evaluateRain(prev: RainState, nowcast: Nowcast, nowMs: number, rules: RainRules): RainDecision {
  const th = rules.rainThreshold;
  const nowRain = nowcast.observation.rainfall;
  const peak = nowcast.forecasts.reduce((max, p) => Math.max(max, p.rainfall), 0);
  const peakLevel = classifyRain(peak, th);
  const result = (action: RainDecision["action"], base: RainState, next: RainState, onset: RainPoint | null) => ({
    action,
    base,
    next,
    onset,
    nowRain,
    peak,
    peakLevel,
  });

  // 1. 雨イベントの終了判定
  let base: RainState = { ...prev };
  if (base.raining && nowRain < th && peak < th) base = { ...base, raining: false };

  if (!base.raining) {
    // 降雨中に初めて検知した場合は通知せず記録のみ
    if (nowRain >= th) {
      base = { ...base, raining: true, lastLevel: classifyRain(Math.max(nowRain, peak), th) };
      return result("none", base, base, null);
    }
    // 2. 新規の雨通知
    const first = nowcast.forecasts.find((p) => p.rainfall >= th);
    if (!first || base.count >= rules.maxAlertsPerDay) return result("none", base, base, null);
    if (base.lastNotifiedAt && nowMs - Date.parse(base.lastNotifiedAt) < rules.alertCooldownMin * 60_000) {
      return result("none", base, base, null);
    }
    const next: RainState = { count: base.count + 1, raining: true, lastNotifiedAt: toJstIso(nowMs), lastLevel: peakLevel };
    return result("notify", base, next, first);
  }

  // 3. 強雨へのエスカレーション（クールダウンは無視）
  if (isSevere(peakLevel) && !isSevere(base.lastLevel) && base.count < rules.maxAlertsPerDay) {
    const onset = nowcast.forecasts.find((p) => isSevere(classifyRain(p.rainfall, th))) ?? null;
    const next: RainState = { ...base, count: base.count + 1, lastNotifiedAt: toJstIso(nowMs), lastLevel: peakLevel };
    return result("escalate", base, next, onset);
  }
  return result("none", base, base, null);
}

/**
 * 全員分の朝の通知を月末まで送れる通数を残せるか（NFR-1-6）。
 * 残り通数 <= 当月の残り日数 × 利用者数 なら、急な雨の通知は送らない。
 */
export async function hasQuotaForAlert(line: LineApi, jst: JstTime, userCount: number): Promise<boolean> {
  const quota = await line.getQuota();
  if (!quota) return true; // 取得できない場合は送信を優先する
  const remaining = quota.limit - quota.used;
  const daysLeft = daysInMonth(jst.year, jst.month) - jst.day + 1;
  return remaining > daysLeft * userCount;
}

export interface RainAlertResult {
  action: RainDecision["action"];
  sent: boolean;
  nowRain: number;
  peak: number;
}

export async function runRainAlert(
  s: Services,
  userId: string,
  settings: Settings,
  nowMs: number,
  userCount: number,
): Promise<RainAlertResult> {
  const location = settings.location;
  if (!location) throw new Error("rainAlert: 地点が未設定");
  const jst = toJst(nowMs);
  const c = s.config;

  const nowcast = await s.fetchNowcast(location.lat, location.lon);
  const prev = await getRainState(s.kv, userId, jst.date);
  const d = evaluateRain(prev, nowcast, nowMs, c);

  let toSave = d.base;
  let sent = false;
  if (d.action !== "none" && d.onset && d.peakLevel) {
    if (await hasQuotaForAlert(s.line, jst, userCount)) {
      try {
        await s.line.push(
          userId,
          rainAlertMessage({
            placeName: location.name,
            kind: d.action,
            onsetMs: d.onset.time,
            nowMs,
            peak: d.peak,
            peakLevel: d.peakLevel,
            count: d.next.count,
            max: c.maxAlertsPerDay,
          }),
        );
        toSave = d.next;
        sent = true;
      } catch (e) {
        console.error("rainAlert: 送信に失敗", e);
      }
    } else {
      console.warn("rainAlert: LINE の送信枠が少ないため、朝の通知を優先して送信を見送りました");
    }
  }

  // KV の書き込みは状態が変わったときだけ
  if (JSON.stringify(toSave) !== JSON.stringify(prev)) await saveRainState(s.kv, userId, jst.date, toSave);
  return { action: d.action, sent, nowRain: d.nowRain, peak: d.peak };
}
