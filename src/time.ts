// 日本時間（JST）の扱い。Workers は UTC で動くため、すべてここを通して変換する。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface JstTime {
  /** YYYY-MM-DD */
  date: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0:00 からの経過分 */
  minutesOfDay: number;
  /** 0 = 日曜 */
  weekday: number;
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toJst(ms: number): JstTime {
  const d = new Date(ms + JST_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  return {
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    year,
    month,
    day,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
    weekday: d.getUTCDay(),
  };
}

/** JST の日時から epoch ミリ秒を作る */
export function jstToMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute) - JST_OFFSET_MS;
}

/** 例: 10月10日(土) */
export function formatDateJa(t: Pick<JstTime, "month" | "day" | "weekday">): string {
  return `${t.month}月${t.day}日(${WEEKDAYS[t.weekday]})`;
}

/** 経過分 → 表示用の時刻（例: 6:30） */
export function formatClock(minutesOfDay: number): string {
  return `${Math.floor(minutesOfDay / 60)}:${pad2(minutesOfDay % 60)}`;
}

/** 保存用の "HH:MM" → 経過分 */
export function parseHm(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/** 例: 2026-10-10T14:00:00+09:00 */
export function toJstIso(ms: number): string {
  const t = toJst(ms);
  const sec = new Date(ms + JST_OFFSET_MS).getUTCSeconds();
  return `${t.date}T${pad2(t.hour)}:${pad2(t.minute)}:${pad2(sec)}+09:00`;
}

/** Yahoo 気象情報API の "YYYYMMDDHHmm"（JST）→ epoch ミリ秒 */
export function parseYahooDate(s: string): number {
  return jstToMs(
    Number(s.slice(0, 4)),
    Number(s.slice(4, 6)),
    Number(s.slice(6, 8)),
    Number(s.slice(8, 10)),
    Number(s.slice(10, 12)),
  );
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
