import { afterEach, describe, expect, it, vi } from "vitest";
import { getMorningFlag, getRainState, getSettings, saveRainState, setMorningFlag } from "../src/state";
import { describeMessage, handleWebhook, processEvents, verifySignature } from "../src/webhook";
import { TOKYO, at, makeServices, storeSettings } from "./helpers";

async function sign(body: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return btoa(String.fromCharCode(...mac));
}

function textEvent(text: string, userId = "Uowner") {
  return { type: "message", replyToken: "rt", source: { userId }, message: { type: "text", text } };
}

/** テキストを送って返信を受け取る */
async function send(s: ReturnType<typeof makeServices>, text: string, nowMs = at(21, 0)): Promise<string> {
  s.line.replies = [];
  await processEvents([textEvent(text)], s, nowMs);
  return s.line.replies[0]?.text ?? "";
}

describe("verifySignature / handleWebhook", () => {
  it("正しい署名なら 200 を返し、イベントを処理する", async () => {
    const s = makeServices();
    const body = JSON.stringify({ events: [textEvent("設定")] });
    const pending: Promise<unknown>[] = [];
    const res = await handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        body,
        headers: { "x-line-signature": await sign(body, "secret") },
      }),
      s,
      (p) => pending.push(p),
    );
    await Promise.all(pending);
    expect(res.status).toBe(200);
    expect(s.line.replies[0].text).toContain("現在の設定");
  });

  it("署名が一致しなければ 401", async () => {
    const s = makeServices();
    const body = JSON.stringify({ events: [textEvent("設定")] });
    const res = await handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        body,
        headers: { "x-line-signature": await sign(body, "wrong") },
      }),
      s,
      () => {},
    );
    expect(res.status).toBe(401);
    expect(s.line.replies).toHaveLength(0);
  });

  it("署名ヘッダーがなければ不一致", async () => {
    expect(await verifySignature("{}", null, "secret")).toBe(false);
  });
});

describe("本人確認", () => {
  it("本人以外のメッセージは無視し、設定も変えない", async () => {
    const s = makeServices();
    await processEvents([textEvent("朝 6:30", "Uother")], s, at(21));
    expect(s.line.replies).toHaveLength(0);
    expect((await getSettings(s.kv, s.config)).morningTime).toBe("07:00");
  });
});

describe("地点", () => {
  it("位置情報を送ると地点を保存する", async () => {
    const s = makeServices();
    await processEvents(
      [
        {
          type: "message",
          replyToken: "rt",
          source: { userId: "Uowner" },
          message: { type: "location", title: "渋谷駅", address: "日本、東京都渋谷区", latitude: 35.658, longitude: 139.7016 },
        },
      ],
      s,
      at(21),
    );
    expect(s.line.replies[0].text).toContain("地点を「渋谷駅」に設定しました");
    expect((await getSettings(s.kv, s.config)).location).toEqual({
      name: "渋谷駅",
      lat: 35.658,
      lon: 139.7016,
      source: "location",
    });
  });

  it("地名を送るとジオコーダで地点を保存する", async () => {
    const s = makeServices({ geocode: async () => ({ name: "東京都渋谷区", lat: 35.664, lon: 139.698 }) });
    expect(await send(s, "地点 渋谷区")).toContain("地点を「東京都渋谷区」に設定しました");
    expect((await getSettings(s.kv, s.config)).location?.source).toBe("geocode");
  });

  it("見つからなければ保存しない", async () => {
    const s = makeServices({ geocode: async () => null });
    expect(await send(s, "地点 しぶやく")).toContain("「しぶやく」が見つかりませんでした");
    expect((await getSettings(s.kv, s.config)).location).toBeNull();
  });

  it("国外なら保存しない", async () => {
    const s = makeServices({ geocode: async () => ({ name: "San Francisco", lat: 37.77, lon: -122.42 }) });
    expect(await send(s, "地点 San Francisco")).toContain("日本国内の地点のみ");
    expect((await getSettings(s.kv, s.config)).location).toBeNull();
  });

  it("ジオコーダが失敗したら再試行を案内する", async () => {
    const s = makeServices({
      geocode: async () => {
        throw new Error("timeout");
      },
    });
    expect(await send(s, "地点 渋谷区")).toContain("時間をおいて再度お試しください");
  });

  it("地点を変えると雨の最中の状態をリセットし、通知回数は残す", async () => {
    const s = makeServices({ geocode: async () => ({ name: "大阪市", lat: 34.69, lon: 135.5 }) });
    await saveRainState(s.kv, "2026-10-10", { count: 2, raining: true, lastNotifiedAt: null, lastLevel: "rain" });
    await send(s, "地点 大阪市", at(14));
    expect(await getRainState(s.kv, "2026-10-10")).toMatchObject({ count: 2, raining: false });
  });

  it("「地点」だけなら現在の地点を返す", async () => {
    const s = makeServices();
    expect(await send(s, "地点")).toContain("📍 地点：未設定");
  });
});

describe("朝の通知時刻", () => {
  it("夜に変更すると明日からの案内になる", async () => {
    const s = makeServices();
    const reply = await send(s, "朝 6:30", at(21));
    expect(reply).toContain("朝の通知時刻を 6:30 に変更しました");
    expect(reply).toContain("次回は 明日 10月11日(日) 6:30");
    expect((await getSettings(s.kv, s.config)).morningTime).toBe("06:30");
  });

  it("新しい時刻より前に変更すると今日からの案内になる", async () => {
    const s = makeServices();
    expect(await send(s, "朝 6時半", at(5))).toContain("次回は 今日 10月10日(土) 6:30");
    expect(await getMorningFlag(s.kv, "2026-10-10")).toBeNull();
  });

  it("新しい時刻を過ぎてから変更すると、今日は送らない（skipped）", async () => {
    const s = makeServices();
    expect(await send(s, "朝 6:30", at(6, 45))).toContain("明日");
    expect(await getMorningFlag(s.kv, "2026-10-10")).toBe("skipped");
  });

  it("skipped の日に、まだ来ていない時刻へ変え直すと今日の通知が復活する", async () => {
    const s = makeServices();
    await setMorningFlag(s.kv, "2026-10-10", "skipped");
    expect(await send(s, "朝 8:00", at(6, 50))).toContain("今日");
    expect(await getMorningFlag(s.kv, "2026-10-10")).toBeNull();
  });

  it("今日が送信済みなら明日から", async () => {
    const s = makeServices();
    await setMorningFlag(s.kv, "2026-10-10", "sent");
    expect(await send(s, "朝 10:00", at(7, 30))).toContain("明日");
    expect(await getMorningFlag(s.kv, "2026-10-10")).toBe("sent");
  });

  it.each(["朝 13:00", "朝 6:35", "朝 あさ"])("「%s」はエラーで、設定は変えない", async (text) => {
    const s = makeServices();
    expect(await send(s, text)).toContain("4:00〜11:50 の間で、10分単位");
    expect((await getSettings(s.kv, s.config)).morningTime).toBe("07:00");
  });
});

describe("急な雨の通知時間帯", () => {
  it("変更を保存して返信する", async () => {
    const s = makeServices();
    expect(await send(s, "雨 7-22")).toContain("急な雨のお知らせを 7:00〜22:00 に変更しました");
    expect((await getSettings(s.kv, s.config)).rainHours).toEqual({ start: 7, end: 22 });
  });

  it("日付をまたぐ指定はエラーで、設定は変えない", async () => {
    const s = makeServices();
    expect(await send(s, "雨 22-7")).toContain("日付をまたぐ指定はできません");
    expect((await getSettings(s.kv, s.config)).rainHours).toEqual({ start: 6, end: 23 });
  });
});

describe("ログに地名を残さない", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureLogs(): () => string {
    const spies = (["log", "warn", "error"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    return () => spies.flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(" "))).join("\n");
  }

  it("位置情報・地名・見つからない地名・設定の確認のどれでも、ログに地名や住所が出ない", async () => {
    const logs = captureLogs();
    const s = makeServices({
      geocode: async (q) => (q === "横浜市" ? { name: "神奈川県横浜市", lat: 35.45, lon: 139.63 } : null),
    });
    await processEvents(
      [
        {
          type: "message",
          replyToken: "rt",
          source: { userId: "Uowner" },
          message: { type: "location", address: "日本、〒220-0000 神奈川県横浜市西区みなとみらい1-2", latitude: 35.45, longitude: 139.63 },
        },
        textEvent("地点 横浜市"),
        textEvent("地点 しぶやく"),
        textEvent("設定"),
        textEvent("地点"),
      ],
      s,
      at(21),
    );
    expect(s.line.replies).toHaveLength(5);
    const output = logs();
    expect(output).toContain("webhook: location に返信");
    expect(output).toContain("webhook: text:location に返信");
    for (const word of ["横浜", "神奈川", "みなとみらい", "しぶやく", "220"]) expect(output).not.toContain(word);
  });

  it("保存データが壊れていても、エラーログに保存値の中身が出ない", async () => {
    const logs = captureLogs();
    const s = makeServices();
    await s.kv.put("settings", '{"location":{"name":"神奈川県横浜市"');
    await processEvents([textEvent("設定")], s, at(21));
    expect(logs()).toContain("settings の読み込みに失敗");
    expect(logs()).not.toContain("横浜");
  });

  it("describeMessage はコマンドの種類だけを返す", () => {
    expect(describeMessage({ type: "text", text: "地点 横浜市" })).toBe("text:location");
    expect(describeMessage({ type: "text", text: "こんにちは" })).toBe("text:unknown");
    expect(describeMessage({ type: "location", latitude: 35, longitude: 136 })).toBe("location");
  });
});

describe("友だち追加（follow）", () => {
  function followEvent(userId = "Uowner") {
    return { type: "follow", replyToken: "rt", source: { userId } };
  }

  it("地点が未設定なら、あいさつ・地点設定のお願い・使い方を返す", async () => {
    const s = makeServices();
    await processEvents([followEvent()], s, at(21));
    const text = s.line.replies[0].text;
    expect(text.startsWith("👋 友だち追加ありがとうございます！")).toBe(true);
    expect(text).toContain("まずは、天気を調べる地点を設定してください");
    expect(text).toContain("☂️ 雨通知の使い方");
    expect(text).not.toContain("現在の設定");
  });

  it("地点が設定済み（ブロック解除など）なら、現在の設定と使い方を返す", async () => {
    const s = makeServices();
    await storeSettings(s.kv, { location: TOKYO, morningTime: "06:30" });
    await processEvents([followEvent()], s, at(21));
    const text = s.line.replies[0].text;
    expect(text).toContain("⚙️ 現在の設定");
    expect(text).toContain("⏰ 朝の通知：6:30");
    expect(text).toContain("☂️ 雨通知の使い方");
    expect(text).not.toContain("まずは");
  });

  it("本人以外の友だち追加には返信しない", async () => {
    const s = makeServices();
    await processEvents([followEvent("Uother")], s, at(21));
    expect(s.line.replies).toHaveLength(0);
  });

  it("ブロック（unfollow）には返信しない", async () => {
    const s = makeServices();
    await processEvents([{ type: "unfollow", replyToken: "rt", source: { userId: "Uowner" } }], s, at(21));
    expect(s.line.replies).toHaveLength(0);
  });

  it("ログには follow とだけ書き、地名を出さない", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const s = makeServices();
    await storeSettings(s.kv, { location: TOKYO });
    await processEvents([followEvent()], s, at(21));
    const output = log.mock.calls.map((args) => args.join(" ")).join("\n");
    vi.restoreAllMocks();
    expect(output).toContain("webhook: follow に返信");
    expect(output).not.toContain("渋谷");
  });
});

describe("設定・ヘルプ", () => {
  it("「設定」でまとめて返す", async () => {
    const s = makeServices();
    await storeSettings(s.kv, { location: TOKYO, morningTime: "06:30", rainHours: { start: 7, end: 22 } });
    expect(await send(s, "設定")).toBe(
      ["⚙️ 現在の設定", "📍 地点：東京都渋谷区", "⏰ 朝の通知：6:30", "🌧️ 急な雨のお知らせ：7:00〜22:00"].join("\n"),
    );
  });

  it("知らない言葉には使い方を返す", async () => {
    const s = makeServices();
    expect(await send(s, "こんにちは")).toContain("雨通知の使い方");
  });

  it("スタンプには使い方を返す", async () => {
    const s = makeServices();
    await processEvents(
      [{ type: "message", replyToken: "rt", source: { userId: "Uowner" }, message: { type: "sticker" } }],
      s,
      at(21),
    );
    expect(s.line.replies[0].text).toContain("雨通知の使い方");
  });
});
