// LINE Messaging API クライアント（spec.md 3.3 / 3.4 / 3.5.8）

import type { FetchLike } from "../http";
import { defaultFetch, defaultSleep } from "../http";

const API = "https://api.line.me/v2/bot";
const MAX_RETRIES = 2;

export interface Quota {
  limit: number;
  used: number;
}

export interface LineApi {
  /** 利用者へのプッシュ送信（月200通の枠を消費する） */
  push(text: string): Promise<void>;
  /** 応答メッセージ（通数に数えない） */
  reply(replyToken: string, text: string): Promise<void>;
  /** 当月の送信枠。取得できなければ null */
  getQuota(): Promise<Quota | null>;
}

export class LineClient implements LineApi {
  constructor(
    private readonly token: string,
    private readonly userId: string,
    private readonly fetchImpl: FetchLike = defaultFetch,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...extra };
  }

  async push(text: string): Promise<void> {
    // 同じ Retry Key で再送すれば、LINE 側で二重送信が防がれる
    const retryKey = crypto.randomUUID();
    const body = JSON.stringify({ to: this.userId, messages: [{ type: "text", text }] });
    let lastError = "";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await this.sleep(1000 * attempt);
      let res: Response;
      try {
        res = await this.fetchImpl(`${API}/message/push`, {
          method: "POST",
          headers: this.headers({ "X-Line-Retry-Key": retryKey }),
          body,
        });
      } catch (e) {
        lastError = String(e);
        continue;
      }
      if (res.ok) return;
      // 409: 同じ Retry Key のリクエストが受け付け済み
      if (res.status === 409) return;
      lastError = `${res.status} ${await res.text()}`;
      if (res.status !== 429 && res.status < 500) break;
    }
    throw new Error(`LINE push 失敗: ${lastError}`);
  }

  async reply(replyToken: string, text: string): Promise<void> {
    const res = await this.fetchImpl(`${API}/message/reply`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    });
    if (!res.ok) throw new Error(`LINE reply 失敗: ${res.status} ${await res.text()}`);
  }

  async getQuota(): Promise<Quota | null> {
    try {
      const [quotaRes, usageRes] = await Promise.all([
        this.fetchImpl(`${API}/message/quota`, { headers: this.headers() }),
        this.fetchImpl(`${API}/message/quota/consumption`, { headers: this.headers() }),
      ]);
      if (!quotaRes.ok || !usageRes.ok) return null;
      const quota = (await quotaRes.json()) as { type: string; value?: number };
      const usage = (await usageRes.json()) as { totalUsage: number };
      const limit = quota.type === "limited" ? Number(quota.value) : Infinity;
      return { limit, used: Number(usage.totalUsage) };
    } catch (e) {
      console.error("line: 送信枠の取得に失敗", e);
      return null;
    }
  }
}
