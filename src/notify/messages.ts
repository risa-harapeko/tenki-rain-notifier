// LINE に送るメッセージ文面（spec.md 3.1.4 / 3.2.4 / 3.5.7）

import type { RainHours } from "../commands/schedule";
import type { Settings } from "../state";
import type { DailyForecast } from "../weather/openMeteo";
import type { RainLevel } from "../weather/rainLevel";
import { RAIN_LEVEL_LABEL } from "../weather/rainLevel";
import type { UmbrellaResult } from "../weather/umbrella";
import { describeWeather } from "../weather/weatherCode";
import { formatClock, parseHm, toJst } from "../time";

export function formatRainHours(h: RainHours): string {
  return `${h.start}:00〜${h.end}:00`;
}

function formatMorningTime(hm: string): string {
  return formatClock(parseHm(hm));
}

function formatTemp(v: number | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? `${Math.round(v)}℃` : "--";
}

function formatMm(v: number): string {
  return String(Math.round(v * 10) / 10);
}

// ---- 朝の通知 ----

export function morningMessage(placeName: string, dateJa: string, daily: DailyForecast, umbrella: UmbrellaResult): string {
  const lines = [
    "☀️ おはようございます！",
    `【${placeName}】${dateJa}の天気`,
    "",
    `天気：${describeWeather(daily.weatherCode)}`,
    `気温：最高 ${formatTemp(daily.tempMax)} / 最低 ${formatTemp(daily.tempMin)}`,
    `降水確率：${daily.precipProbMax === null ? "--" : `${daily.precipProbMax}%`}`,
    "",
  ];
  if (umbrella.level === "required") {
    lines.push("☔ 傘が必要です");
    if (umbrella.rainStartHour !== null) lines.push(`（${umbrella.rainStartHour}時ごろから雨）`);
  } else if (umbrella.level === "folding") {
    lines.push("🌂 折りたたみ傘があると安心です");
    if (umbrella.rainStartHour !== null) lines.push(`（${umbrella.rainStartHour}時ごろから雨の可能性）`);
  } else {
    lines.push("👍 傘は不要です");
  }
  return lines.join("\n");
}

export function morningFailedMessage(): string {
  return ["⚠️ 今朝の天気予報を取得できませんでした。", "お手数ですが天気アプリ等でご確認ください。"].join("\n");
}

// ---- 急な雨の通知 ----

export interface RainAlertInfo {
  placeName: string;
  kind: "notify" | "escalate";
  /** 降り始め（エスカレーション時は強い雨になる）予想時刻 */
  onsetMs: number;
  nowMs: number;
  peak: number;
  peakLevel: RainLevel;
  count: number;
  max: number;
}

export function rainAlertMessage(info: RainAlertInfo): string {
  const lines: string[] = [];
  if (info.peakLevel === "intense") {
    lines.push("🚨【激しい雨に注意】ゲリラ豪雨の恐れ");
  } else if (info.peakLevel === "heavy") {
    lines.push("⚠️【強い雨に注意】");
  } else {
    lines.push("☔ まもなく雨が降りそうです");
  }
  lines.push(`【${info.placeName}】`, "");

  const minutes = Math.max(0, Math.round((info.onsetMs - info.nowMs) / 60000));
  const onset = toJst(info.onsetMs);
  const when = minutes === 0 ? "まもなく" : `約${minutes}分後（${formatClock(onset.minutesOfDay)}ごろ）`;
  lines.push(`${info.kind === "escalate" ? "雨が強まる時刻" : "降り始め"}：${when}`);
  lines.push(`予想される強さ：${RAIN_LEVEL_LABEL[info.peakLevel]}（最大 ${formatMm(info.peak)}mm/h）`);

  if (info.peakLevel === "intense") {
    lines.push("屋内への避難・外出の見合わせを検討してください。");
  } else if (info.peakLevel === "heavy") {
    lines.push("外出中の方は早めに屋内へ移動してください。");
  }

  lines.push("", `（本日の雨通知 ${info.count}/${info.max}）`, "Web Services by Yahoo! JAPAN");
  return lines.join("\n");
}

// ---- 設定・案内 ----

export function helpMessage(): string {
  return [
    "☂️ 雨通知の使い方",
    "",
    "■ 地点",
    "・「＋」→「位置情報」で場所を送る",
    "・または「地点 渋谷区」のように送る",
    "",
    "■ 朝の通知時刻（4:00〜11:50、10分単位）",
    "・「朝 6:30」のように送る",
    "",
    "■ 急な雨のお知らせ時間帯（0〜24時）",
    "・「雨 7-22」のように送る",
    "",
    "■ 今の設定を見る",
    "・「設定」と送る",
  ].join("\n");
}

export function setupNeededMessage(): string {
  return `⚠️ 天気を調べる地点がまだ設定されていません。\n\n${helpMessage()}`;
}

export function locationSetMessage(name: string, morningTime: string): string {
  return [
    `📍 地点を「${name}」に設定しました。`,
    `次回の朝の通知（${formatMorningTime(morningTime)}）から、この地点の天気をお知らせします。`,
    "急な雨のお知らせもこの地点で行います。",
  ].join("\n");
}

export function locationNotFoundMessage(query: string): string {
  return [`🔍「${query}」が見つかりませんでした。`, "市区町村名など、別の書き方でお試しください。", "（例：地点 渋谷区）"].join(
    "\n",
  );
}

export function outsideJapanMessage(): string {
  return "🗾 日本国内の地点のみ設定できます。";
}

export function tryAgainLaterMessage(): string {
  return "⏳ ただいま地点を検索できませんでした。時間をおいて再度お試しください。";
}

export function morningTimeSetMessage(morningTime: string, nextIsToday: boolean, dateJa: string): string {
  const clock = formatMorningTime(morningTime);
  return [
    `⏰ 朝の通知時刻を ${clock} に変更しました。`,
    `次回は ${nextIsToday ? "今日" : "明日"} ${dateJa} ${clock} にお知らせします。`,
  ].join("\n");
}

export function morningTimeErrorMessage(): string {
  return ["⚠️ 朝の通知時刻は 4:00〜11:50 の間で、10分単位で指定してください。", "（例：朝 6:30）"].join("\n");
}

export function rainHoursSetMessage(hours: RainHours): string {
  return [`🌧️ 急な雨のお知らせを ${formatRainHours(hours)} に変更しました。`, "この時間帯の外ではお知らせしません。"].join(
    "\n",
  );
}

export function rainHoursErrorMessage(): string {
  return [
    "⚠️ 時間帯は「雨 7-22」のように、開始と終了の時（0〜24）で指定してください。",
    "開始は終了より前にしてください（日付をまたぐ指定はできません）。",
  ].join("\n");
}

function locationLine(s: Settings): string {
  return `📍 地点：${s.location ? s.location.name : "未設定"}`;
}

function morningLine(s: Settings): string {
  return `⏰ 朝の通知：${formatMorningTime(s.morningTime)}`;
}

function rainLine(s: Settings): string {
  return `🌧️ 急な雨のお知らせ：${formatRainHours(s.rainHours)}`;
}

export function settingsMessage(s: Settings): string {
  return ["⚙️ 現在の設定", locationLine(s), morningLine(s), rainLine(s)].join("\n");
}

export function currentLocationMessage(s: Settings): string {
  return [locationLine(s), "変更するには、位置情報を送るか「地点 ◯◯」と送ってください。"].join("\n");
}

export function currentMorningMessage(s: Settings): string {
  return [morningLine(s), "変更するには「朝 6:30」のように送ってください。"].join("\n");
}

export function currentRainMessage(s: Settings): string {
  return [rainLine(s), "変更するには「雨 7-22」のように送ってください。"].join("\n");
}
