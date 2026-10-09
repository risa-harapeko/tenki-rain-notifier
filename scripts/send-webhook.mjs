// ローカルの `npm run dev` に、署名付きのテスト用 Webhook リクエストを送る（spec.md 9.2）
//
// 使い方:
//   npm run send-webhook -- "朝 6:30"
//   npm run send-webhook -- --location 35.658 139.7016 渋谷駅
//
// LINE_CHANNEL_SECRET と LINE_USER_ID は .dev.vars から読む（環境変数があればそちらを優先）。
// replyToken はダミーのため、LINE への返信は失敗する。返信内容は wrangler dev のログで確認する。

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

function loadDevVars() {
  try {
    return Object.fromEntries(
      readFileSync(".dev.vars", "utf8")
        .split(/\r?\n/)
        .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
        .map((line) => {
          const i = line.indexOf("=");
          return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

const vars = { ...loadDevVars(), ...process.env };
const secret = vars.LINE_CHANNEL_SECRET;
const userId = vars.LINE_USER_ID;
const url = vars.WEBHOOK_URL ?? "http://localhost:8787/webhook";
if (!secret || !userId) {
  console.error("LINE_CHANNEL_SECRET と LINE_USER_ID を .dev.vars か環境変数で指定してください");
  process.exit(1);
}

const args = process.argv.slice(2);
let message;
if (args[0] === "--location") {
  const [lat, lon, ...title] = args.slice(1);
  message = { type: "location", latitude: Number(lat), longitude: Number(lon), title: title.join(" "), address: "" };
} else {
  message = { type: "text", text: args.join(" ") || "ヘルプ" };
}

const body = JSON.stringify({
  destination: "test",
  events: [{ type: "message", replyToken: "dummy-reply-token", source: { type: "user", userId }, message }],
});
const signature = createHmac("sha256", secret).update(body).digest("base64");

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-line-signature": signature },
  body,
});
console.log(`${res.status} ${await res.text()}`);
