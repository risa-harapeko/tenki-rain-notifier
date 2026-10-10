import { describe, expect, it } from "vitest";
import { addUser, defaultSettings, getMorningFlag } from "../src/state";
import type { Settings } from "../src/state";
import { DEFAULT_CONFIG } from "../src/config";
import { planTick, runTick } from "../src/tick";
import { toJst } from "../src/time";
import { OWNER, TOKYO, at, makeServices, nowcast, sampleForecast, storeSettings } from "./helpers";

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(DEFAULT_CONFIG), location: TOKYO, ...overrides };
}

describe("planTick", () => {
  it("設定時刻ちょうどに朝の通知を実行する", () => {
    expect(planTick(settings(), null, toJst(at(7, 0))).morning).toBe(true);
  });

  it("設定時刻の前は実行しない", () => {
    expect(planTick(settings(), null, toJst(at(6, 50))).morning).toBe(false);
  });

  it("30分の猶予内で未送信なら実行する（cron の欠落対策）", () => {
    expect(planTick(settings(), null, toJst(at(7, 20))).morning).toBe(true);
  });

  it("猶予を過ぎたら実行しない", () => {
    expect(planTick(settings(), null, toJst(at(7, 30))).morning).toBe(false);
  });

  it("送信済み・skipped なら実行しない", () => {
    expect(planTick(settings(), "sent", toJst(at(7, 0))).morning).toBe(false);
    expect(planTick(settings(), "skipped", toJst(at(7, 0))).morning).toBe(false);
  });

  it("変更した朝の通知時刻に従う", () => {
    const s = settings({ morningTime: "06:30" });
    expect(planTick(s, null, toJst(at(6, 30))).morning).toBe(true);
    expect(planTick(s, null, toJst(at(7, 0))).morning).toBe(false);
  });

  it("急な雨チェックは時間帯の開始時から、終了時の前まで", () => {
    const s = settings({ rainHours: { start: 7, end: 22 } });
    expect(planTick(s, null, toJst(at(6, 50))).rain).toBe(false);
    expect(planTick(s, null, toJst(at(7, 0))).rain).toBe(true);
    expect(planTick(s, null, toJst(at(21, 50))).rain).toBe(true);
    expect(planTick(s, null, toJst(at(22, 0))).rain).toBe(false);
  });

  it("0-24 なら終日チェックする", () => {
    const s = settings({ rainHours: { start: 0, end: 24 } });
    expect(planTick(s, null, toJst(at(0, 0))).rain).toBe(true);
    expect(planTick(s, null, toJst(at(23, 50))).rain).toBe(true);
  });

  it("地点が未設定なら朝の通知も急な雨チェックもしない", () => {
    expect(planTick(settings({ location: null }), null, toJst(at(14, 0))).rain).toBe(false);
    expect(planTick(settings({ location: null }), null, toJst(at(7, 0))).morning).toBe(false);
  });
});

describe("runTick（朝の通知）", () => {
  it("天気と傘の要否を送り、送信済みにする", async () => {
    const probs = Array(24).fill(0);
    probs[15] = 60;
    const s = makeServices({ fetchForecast: async () => sampleForecast(probs) });
    await storeSettings(s.kv, {});
    await runTick(s, at(7, 0));
    expect(s.line.pushes).toHaveLength(1);
    expect(s.line.pushes[0]).toContain("【東京都渋谷区】10月10日(土)の天気");
    expect(s.line.pushes[0]).toContain("☔ 傘が必要です");
    expect(s.line.pushes[0]).toContain("（15時ごろから雨）");
    expect(await getMorningFlag(s.kv, "Uowner", "2026-10-10")).toBe("sent");
  });

  it("同じ日に2回は送らない", async () => {
    const s = makeServices();
    await storeSettings(s.kv, {});
    await runTick(s, at(7, 0));
    await runTick(s, at(7, 10));
    expect(s.line.pushes).toHaveLength(1);
  });

  it("地点が未設定なら朝の通知を送らない（通数を使わない）", async () => {
    const s = makeServices();
    await runTick(s, at(7, 0));
    expect(s.line.pushes).toHaveLength(0);
  });

  it("天気予報が取れなければ3回試して、取得失敗を知らせる", async () => {
    let calls = 0;
    const s = makeServices({
      fetchForecast: async () => {
        calls++;
        throw new Error("down");
      },
    });
    await storeSettings(s.kv, {});
    await runTick(s, at(7, 0));
    expect(calls).toBe(3);
    expect(s.line.pushes[0]).toContain("天気予報を取得できませんでした");
  });

  it("送信に失敗したら送信済みにせず、次の実行で再送する", async () => {
    const s = makeServices();
    await storeSettings(s.kv, { rainHours: { start: 0, end: 1 } });
    s.line.failPush = true;
    await runTick(s, at(7, 0));
    expect(await getMorningFlag(s.kv, "Uowner", "2026-10-10")).toBeNull();
    s.line.failPush = false;
    await runTick(s, at(7, 10));
    expect(s.line.pushes).toHaveLength(1);
  });
});

describe("runTick（急な雨）", () => {
  it("時間帯内なら急な雨をチェックして通知する", async () => {
    const s = makeServices({ fetchNowcast: async () => nowcast(0, [3, 3, 0, 0, 0, 0]) });
    await storeSettings(s.kv, {});
    await runTick(s, at(14, 0));
    expect(s.line.pushes[0]).toContain("まもなく雨が降りそうです");
  });

  it("時間帯外ならチェックしない", async () => {
    let called = false;
    const s = makeServices({
      fetchNowcast: async () => {
        called = true;
        return nowcast(0, [3, 3, 0, 0, 0, 0]);
      },
    });
    await storeSettings(s.kv, { rainHours: { start: 7, end: 22 } });
    await runTick(s, at(22, 0));
    expect(called).toBe(false);
    expect(s.line.pushes).toHaveLength(0);
  });
});

describe("runTick（複数の利用者）", () => {
  const OSAKA = { name: "大阪府大阪市北区", lat: 34.7, lon: 135.5, source: "geocode" as const };

  it("利用者ごとの設定時刻・地点で、それぞれに朝の通知を送る", async () => {
    const s = makeServices({
      fetchForecast: async (lat) => sampleForecast(lat === OSAKA.lat ? Array(24).fill(80) : undefined),
    });
    await addUser(s.kv, OWNER, "Ufriend");
    await storeSettings(s.kv, { location: TOKYO, morningTime: "07:00" });
    await storeSettings(s.kv, { location: OSAKA, morningTime: "06:30" }, "Ufriend");

    await runTick(s, at(6, 30));
    expect(s.line.pushedTo).toEqual(["Ufriend"]);
    expect(s.line.pushes[0]).toContain("【大阪府大阪市北区】");
    expect(s.line.pushes[0]).toContain("☔ 傘が必要です");

    await runTick(s, at(7, 0));
    expect(s.line.pushedTo).toEqual(["Ufriend", OWNER]);
    expect(s.line.pushes[1]).toContain("【東京都渋谷区】");
    expect(s.line.pushes[1]).toContain("👍 傘は不要です");
  });

  it("同じ地点の利用者が複数いても、雨雲の予測は1回だけ取得し、全員に知らせる", async () => {
    let calls = 0;
    const s = makeServices({
      fetchNowcast: async () => {
        calls++;
        return nowcast(0, [3, 3, 0, 0, 0, 0]);
      },
    });
    await addUser(s.kv, OWNER, "Ufriend");
    await storeSettings(s.kv, {});
    await storeSettings(s.kv, {}, "Ufriend");
    await runTick(s, at(14, 0));
    expect(calls).toBe(1);
    expect(s.line.pushedTo).toEqual([OWNER, "Ufriend"]);
  });

  it("送信枠は全員分の朝の通知を残す（利用者数が多いほど早めに急な雨の通知を止める）", async () => {
    const s = makeServices({ fetchNowcast: async () => nowcast(0, [3, 3, 0, 0, 0, 0]) });
    // 10月10日 → 残り22日。2人なら朝の分として44通を残す
    s.line.quota = { limit: 200, used: 156 }; // 残り44
    await addUser(s.kv, OWNER, "Ufriend");
    await storeSettings(s.kv, {});
    await storeSettings(s.kv, { location: null }, "Ufriend");
    await runTick(s, at(14, 0));
    expect(s.line.pushes).toHaveLength(0);
  });

  it("ログに LINE ユーザーID を出さない", async () => {
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      const s = makeServices();
      await addUser(s.kv, OWNER, "Ufriend");
      await storeSettings(s.kv, {}, "Ufriend");
      await runTick(s, at(14, 0));
    } finally {
      console.log = original;
    }
    expect(logs.join("\n")).toContain("user2");
    expect(logs.join("\n")).not.toMatch(/Uowner|Ufriend/);
  });
});

describe("1人用の形式からの移行", () => {
  it("以前の settings・当日の送信済みフラグを管理者のものとして引き継ぐ", async () => {
    const s = makeServices();
    await s.kv.put("settings", JSON.stringify({ location: TOKYO, morningTime: "07:00", rainHours: { start: 6, end: 23 } }));
    await s.kv.put("morning:2026-10-10", "sent");
    await runTick(s, at(7, 0));
    // 送信済みが引き継がれているので、同じ日に二重に送らない
    expect(s.line.pushes).toHaveLength(0);
    expect(s.kv.data.has("settings")).toBe(false);
    expect(s.kv.data.has("morning:2026-10-10")).toBe(false);
    expect(await getMorningFlag(s.kv, OWNER, "2026-10-10")).toBe("sent");
    expect(JSON.parse(s.kv.data.get(`settings:${OWNER}`)!).location.name).toBe("東京都渋谷区");
  });

  it("移行済みなら何もしない", async () => {
    const s = makeServices();
    await storeSettings(s.kv, {});
    const writes = s.kv.writes;
    await runTick(s, at(3, 0));
    expect(s.kv.writes).toBe(writes);
  });
});
