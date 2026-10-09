// 朝の通知時刻・急な雨の通知時間帯の解析と検証（spec.md 3.5.6）

import type { JstTime } from "../time";
import { pad2 } from "../time";
import { normalizeText } from "./parse";

export const MORNING_EARLIEST = 4 * 60; // 4:00
export const MORNING_LATEST = 11 * 60 + 50; // 11:50
export const MORNING_STEP_MIN = 10;
/** cron の欠落に備えて、設定時刻からこの分数までは朝の通知を送る（spec.md 3.0） */
export const MORNING_GRACE_MIN = 30;

export interface RainHours {
  start: number;
  end: number;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false };

/** 朝の通知時刻を経過分にする。受け付ける例: 6:30 / 06:30 / 6時30分 / 6時30 / 6時半 / 7時 */
export function parseMorningTime(input: string): Parsed<number> {
  const s = normalizeText(input).replace(/ /g, "");
  let hour: number;
  let minute: number;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(s))) {
    hour = Number(m[1]);
    minute = Number(m[2]);
  } else if ((m = /^(\d{1,2})時半$/.exec(s))) {
    hour = Number(m[1]);
    minute = 30;
  } else if ((m = /^(\d{1,2})時(?:(\d{1,2})分?)?$/.exec(s))) {
    hour = Number(m[1]);
    minute = m[2] === undefined ? 0 : Number(m[2]);
  } else {
    return { ok: false };
  }
  if (hour > 23 || minute > 59) return { ok: false };
  const minutes = hour * 60 + minute;
  if (minutes < MORNING_EARLIEST || minutes > MORNING_LATEST) return { ok: false };
  if (minute % MORNING_STEP_MIN !== 0) return { ok: false };
  return { ok: true, value: minutes };
}

/** 経過分 → 保存用の "HH:MM" */
export function toStoredTime(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/** 急な雨の通知時間帯。受け付ける例: 7-22 / 7時〜22時 / 0-24 */
export function parseRainHours(input: string): Parsed<RainHours> {
  const s = normalizeText(input).replace(/ /g, "");
  const m = /^(\d{1,2})時?[-~〜ー−–—](\d{1,2})時?$/.exec(s);
  if (!m) return { ok: false };
  const hours = { start: Number(m[1]), end: Number(m[2]) };
  return isValidRainHours(hours) ? { ok: true, value: hours } : { ok: false };
}

export function isValidRainHours(h: RainHours): boolean {
  return (
    Number.isInteger(h.start) &&
    Number.isInteger(h.end) &&
    h.start >= 0 &&
    h.start < h.end &&
    h.end <= 24
  );
}

export interface MorningChangePlan {
  /** 今日の通知を送らないよう "skipped" を書き込むか */
  skipToday: boolean;
  /** 次回の通知が今日か */
  nextIsToday: boolean;
}

/**
 * 朝の通知時刻を変更したときの扱い（FR-6-7）。
 * 今日がまだ未送信で、新しい時刻より前なら今日から。すでに過ぎていれば今日は送らず明日から。
 */
export function planMorningChange(newMinutes: number, now: JstTime, alreadyFlagged: boolean): MorningChangePlan {
  if (alreadyFlagged) return { skipToday: false, nextIsToday: false };
  if (now.minutesOfDay < newMinutes) return { skipToday: false, nextIsToday: true };
  return { skipToday: true, nextIsToday: false };
}
