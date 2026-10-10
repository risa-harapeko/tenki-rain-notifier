// LINE からの設定変更・利用者の登録（spec.md 3.5 / 3.6）

import { UNKNOWN_PLACE_NAME, isInJapan, roundCoord, shortenAddress } from "./commands/location";
import { normalizeText, parseCommand } from "./commands/parse";
import { parseMorningTime, parseRainHours, planMorningChange, toStoredTime } from "./commands/schedule";
import * as msg from "./notify/messages";
import type { Services } from "./services";
import type { Location, Settings } from "./state";
import {
  addUser,
  clearMorningFlag,
  deleteSettings,
  getMorningFlag,
  getRainState,
  getSettings,
  getUsers,
  migrateLegacyData,
  removeUser,
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
  if (events.length === 0) return;
  await migrateLegacyData(s.kv, s.ownerId, toJst(nowMs).date);

  for (const event of events) {
    const userId = event.source?.userId;
    if (!userId) continue;
    try {
      // unfollow（ブロック）には返信できないため、データの削除だけを行う
      if (event.type === "unfollow") {
        await handleUnfollow(s, userId);
        continue;
      }
      if (!event.replyToken) continue;
      const isMessage = event.type === "message" && event.message !== undefined;
      // follow: 友だち追加・ブロック解除
      if (!isMessage && event.type !== "follow") continue;

      const users = await getUsers(s.kv, s.ownerId);
      const registered = users.includes(userId);
      const kind = isMessage ? describeMessage(event.message!) : "follow";
      let text: string;
      if (!registered) {
        text = isMessage ? await respondToGuest(event.message!, s, userId, users) : msg.invitePromptMessage();
      } else {
        text = isMessage ? await respond(event.message!, s, userId, users, nowMs) : msg.welcomeMessage();
      }
      // 個人情報を残さないよう、ログには返信文・LINE ユーザーID ではなくメッセージの種類だけを書く
      console.log(`webhook: ${kind}${registered ? "" : "（未登録）"} に返信`);
      await s.line.reply(event.replyToken, text);
    } catch (e) {
      console.error("webhook: イベントの処理に失敗", e);
    }
  }
}

/** ブロックされたら、その人の設定を削除し、登録を解除する（FR-7-6） */
async function handleUnfollow(s: Services, userId: string): Promise<void> {
  const users = await getUsers(s.kv, s.ownerId);
  if (!users.includes(userId)) return;
  await deleteSettings(s.kv, userId);
  // 管理者は常に利用できるため、登録は解除しない
  if (userId !== s.ownerId) await removeUser(s.kv, s.ownerId, userId);
  console.log(`webhook: unfollow のため${userId === s.ownerId ? "管理者の" : "利用者の"}設定を削除`);
}

/** ログ用のメッセージの種類（例: location / text:morning）。送られてきた値そのものは含めない */
export function describeMessage(message: LineMessage): string {
  if (message.type === "text" && typeof message.text === "string") return `text:${parseCommand(message.text).type}`;
  return message.type;
}

/** 登録していない人からのメッセージ。招待コードだけを受け付ける（FR-7-2〜FR-7-4） */
async function respondToGuest(message: LineMessage, s: Services, userId: string, users: string[]): Promise<string> {
  if (message.type !== "text" || typeof message.text !== "string") return msg.invitePromptMessage();
  const cmd = parseCommand(message.text);
  if (cmd.type !== "invite" || !cmd.arg) return msg.invitePromptMessage();

  if (!s.inviteCode) return msg.inviteClosedMessage();
  // 全角・半角、大文字・小文字の違いは区別しない
  const normalizeCode = (code: string) => normalizeText(code).toLowerCase();
  if (!timingSafeEqual(normalizeCode(cmd.arg), normalizeCode(s.inviteCode))) return msg.inviteInvalidMessage();
  if (users.length >= s.config.maxUsers) return msg.inviteFullMessage();

  await addUser(s.kv, s.ownerId, userId);
  console.log("webhook: 新しい利用者を登録");
  return msg.inviteAcceptedMessage();
}

/** 登録済みの利用者からのメッセージに応じて設定を更新し、返信文を返す */
export async function respond(
  message: LineMessage,
  s: Services,
  userId: string,
  users: string[],
  nowMs: number,
): Promise<string> {
  const ctx: Ctx = { s, userId, nowMs, settings: await getSettings(s.kv, s.config, userId) };

  if (message.type === "location") {
    if (typeof message.latitude !== "number" || typeof message.longitude !== "number") return msg.helpMessage();
    // 場所の名前（title）は自宅の建物名などのこともあるため使わない
    return setLocation(ctx, {
      lat: message.latitude,
      lon: message.longitude,
      source: "location",
      addressHint: message.address,
    });
  }
  if (message.type !== "text" || typeof message.text !== "string") return msg.helpMessage();

  const cmd = parseCommand(message.text);
  switch (cmd.type) {
    case "location":
      return cmd.arg ? setLocationByName(ctx, cmd.arg) : msg.currentLocationMessage(ctx.settings);
    case "morning":
      return cmd.arg ? setMorningTime(ctx, cmd.arg) : msg.currentMorningMessage(ctx.settings);
    case "rain":
      return cmd.arg ? setRainHours(ctx, cmd.arg) : msg.currentRainMessage(ctx.settings);
    case "settings":
      return msg.settingsMessage(ctx.settings);
    case "invite":
      return msg.alreadyRegisteredMessage();
    case "usage":
      // 管理者だけに見せる（FR-7-8）
      if (userId !== s.ownerId) return msg.helpMessage();
      return msg.usageMessage(users.length, s.config.maxUsers, await s.line.getQuota());
    default:
      return msg.helpMessage();
  }
}

interface Ctx {
  s: Services;
  userId: string;
  nowMs: number;
  settings: Settings;
}

async function setLocationByName(ctx: Ctx, query: string): Promise<string> {
  let found;
  try {
    found = await ctx.s.geocode(query);
  } catch (e) {
    console.error("webhook: ジオコーダAPIの呼び出しに失敗", e);
    return msg.tryAgainLaterMessage();
  }
  if (!found) return msg.locationNotFoundMessage(query);
  return setLocation(ctx, { lat: found.lat, lon: found.lon, source: "geocode", addressHint: found.name });
}

interface LocationInput {
  lat: number;
  lon: number;
  source: Location["source"];
  /** リバースジオコーダが使えないときに地点名を作るための住所・地名 */
  addressHint?: string;
}

/** 地点を保存する。住所は「都道府県＋市区町村」まで、緯度経度は約1km単位に丸めて持つ */
async function setLocation(ctx: Ctx, input: LocationInput): Promise<string> {
  const { s, userId, nowMs, settings } = ctx;
  if (!isInJapan(input.lat, input.lon)) return msg.outsideJapanMessage();
  const lat = roundCoord(input.lat);
  const lon = roundCoord(input.lon);
  const location: Location = {
    name: await resolvePlaceName(s, lat, lon, input.addressHint),
    lat,
    lon,
    source: input.source,
  };
  await saveSettings(s.kv, userId, { ...settings, location }, nowMs);

  // 前の地点の雨の状態を持ち越さない（通知回数はそのまま）
  const date = toJst(nowMs).date;
  const rain = await getRainState(s.kv, userId, date);
  if (rain.raining) await saveRainState(s.kv, userId, date, { ...rain, raining: false });

  return msg.locationSetMessage(location.name, settings.morningTime);
}

async function resolvePlaceName(s: Services, lat: number, lon: number, addressHint?: string): Promise<string> {
  try {
    const name = await s.reverseGeocode(lat, lon);
    if (name) return name;
  } catch (e) {
    console.error(`webhook: リバースジオコーダAPIの呼び出しに失敗（${(e as Error).message}）`);
  }
  return shortenAddress(addressHint) ?? UNKNOWN_PLACE_NAME;
}

async function setMorningTime(ctx: Ctx, value: string): Promise<string> {
  const { s, userId, nowMs, settings } = ctx;
  const parsed = parseMorningTime(value);
  if (!parsed.ok) return msg.morningTimeErrorMessage();

  const morningTime = toStoredTime(parsed.value);
  const now = toJst(nowMs);
  const flag = await getMorningFlag(s.kv, userId, now.date);
  // "skipped" は以前の時刻変更で書いたものなので、送信済み（"sent"）のときだけ今日は送信済みとみなす
  const plan = planMorningChange(parsed.value, now, flag === "sent");

  await saveSettings(s.kv, userId, { ...settings, morningTime }, nowMs);
  if (plan.skipToday && flag === null) await setMorningFlag(s.kv, userId, now.date, "skipped");
  if (plan.nextIsToday && flag === "skipped") await clearMorningFlag(s.kv, userId, now.date);

  const next = plan.nextIsToday ? now : toJst(nowMs + DAY_MS);
  return msg.morningTimeSetMessage(morningTime, plan.nextIsToday, formatDateJa(next));
}

async function setRainHours(ctx: Ctx, value: string): Promise<string> {
  const { s, userId, nowMs, settings } = ctx;
  const parsed = parseRainHours(value);
  if (!parsed.ok) return msg.rainHoursErrorMessage();
  await saveSettings(s.kv, userId, { ...settings, rainHours: parsed.value }, nowMs);
  return msg.rainHoursSetMessage(parsed.value);
}
