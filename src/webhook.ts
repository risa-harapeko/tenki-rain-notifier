// LINE からの設定変更（spec.md 3.5）

import { isInJapan, nameFromLocationMessage } from "./commands/location";
import { parseCommand } from "./commands/parse";
import { parseMorningTime, parseRainHours, planMorningChange, toStoredTime } from "./commands/schedule";
import * as msg from "./notify/messages";
import type { Services } from "./services";
import type { Location, Settings } from "./state";
import {
  clearMorningFlag,
  getMorningFlag,
  getRainState,
  getSettings,
  saveRainState,
  saveSettings,
  setMorningFlag,
} from "./state";
import { DAY_MS, formatDateJa, toJst } from "./time";

interface LineMessage {
  type: string;
  text?: string;
  title?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: LineMessage;
}

function base64(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** x-line-signature の検証（HMAC-SHA256 → Base64） */
export async function verifySignature(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return timingSafeEqual(base64(mac), signature);
}

export async function handleWebhook(
  request: Request,
  s: Services,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response> {
  const body = await request.text();
  if (!(await verifySignature(body, request.headers.get("x-line-signature"), s.channelSecret))) {
    console.warn("webhook: 署名が一致しません");
    return new Response("unauthorized", { status: 401 });
  }
  let events: LineEvent[];
  try {
    events = JSON.parse(body).events ?? [];
  } catch {
    return new Response("bad request", { status: 400 });
  }
  // LINE は応答が遅いと再送するため、先に 200 を返して処理を続ける
  waitUntil(processEvents(events, s));
  return new Response("ok");
}

export async function processEvents(events: LineEvent[], s: Services, nowMs = Date.now()): Promise<void> {
  for (const event of events) {
    if (event.type !== "message" || !event.message || !event.replyToken) continue;
    if (event.source?.userId !== s.userId) {
      console.warn("webhook: 本人以外からのメッセージを無視しました");
      continue;
    }
    try {
      const text = await respond(event.message, s, nowMs);
      console.log(`webhook: 返信「${text.split("\n")[0]}」`);
      await s.line.reply(event.replyToken, text);
    } catch (e) {
      console.error("webhook: メッセージの処理に失敗", e);
    }
  }
}

/** メッセージに応じて設定を更新し、返信文を返す */
export async function respond(message: LineMessage, s: Services, nowMs: number): Promise<string> {
  const settings = await getSettings(s.kv, s.config);

  if (message.type === "location") {
    if (typeof message.latitude !== "number" || typeof message.longitude !== "number") return msg.helpMessage();
    return setLocation(s, settings, nowMs, {
      name: nameFromLocationMessage(message.title, message.address),
      lat: message.latitude,
      lon: message.longitude,
      source: "location",
    });
  }
  if (message.type !== "text" || typeof message.text !== "string") return msg.helpMessage();

  const cmd = parseCommand(message.text);
  switch (cmd.type) {
    case "location":
      return cmd.arg ? setLocationByName(s, settings, nowMs, cmd.arg) : msg.currentLocationMessage(settings);
    case "morning":
      return cmd.arg ? setMorningTime(s, settings, nowMs, cmd.arg) : msg.currentMorningMessage(settings);
    case "rain":
      return cmd.arg ? setRainHours(s, settings, nowMs, cmd.arg) : msg.currentRainMessage(settings);
    case "settings":
      return msg.settingsMessage(settings);
    default:
      return msg.helpMessage();
  }
}

async function setLocationByName(s: Services, settings: Settings, nowMs: number, query: string): Promise<string> {
  let found;
  try {
    found = await s.geocode(query);
  } catch (e) {
    console.error("webhook: ジオコーダAPIの呼び出しに失敗", e);
    return msg.tryAgainLaterMessage();
  }
  if (!found) return msg.locationNotFoundMessage(query);
  return setLocation(s, settings, nowMs, { ...found, source: "geocode" });
}

async function setLocation(s: Services, settings: Settings, nowMs: number, location: Location): Promise<string> {
  if (!isInJapan(location.lat, location.lon)) return msg.outsideJapanMessage();
  await saveSettings(s.kv, { ...settings, location }, nowMs);

  // 前の地点の雨の状態を持ち越さない（通知回数はそのまま）
  const date = toJst(nowMs).date;
  const rain = await getRainState(s.kv, date);
  if (rain.raining) await saveRainState(s.kv, date, { ...rain, raining: false });

  return msg.locationSetMessage(location.name, settings.morningTime);
}

async function setMorningTime(s: Services, settings: Settings, nowMs: number, value: string): Promise<string> {
  const parsed = parseMorningTime(value);
  if (!parsed.ok) return msg.morningTimeErrorMessage();

  const morningTime = toStoredTime(parsed.value);
  const now = toJst(nowMs);
  const flag = await getMorningFlag(s.kv, now.date);
  // "skipped" は以前の時刻変更で書いたものなので、送信済み（"sent"）のときだけ今日は送信済みとみなす
  const plan = planMorningChange(parsed.value, now, flag === "sent");

  await saveSettings(s.kv, { ...settings, morningTime }, nowMs);
  if (plan.skipToday && flag === null) await setMorningFlag(s.kv, now.date, "skipped");
  if (plan.nextIsToday && flag === "skipped") await clearMorningFlag(s.kv, now.date);

  const next = plan.nextIsToday ? now : toJst(nowMs + DAY_MS);
  return msg.morningTimeSetMessage(morningTime, plan.nextIsToday, formatDateJa(next));
}

async function setRainHours(s: Services, settings: Settings, nowMs: number, value: string): Promise<string> {
  const parsed = parseRainHours(value);
  if (!parsed.ok) return msg.rainHoursErrorMessage();
  await saveSettings(s.kv, { ...settings, rainHours: parsed.value }, nowMs);
  return msg.rainHoursSetMessage(parsed.value);
}
