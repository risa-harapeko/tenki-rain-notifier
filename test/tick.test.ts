import { describe, expect, it } from "vitest";
import { defaultSettings, getMorningFlag } from "../src/state";
import type { Settings } from "../src/state";
import { DEFAULT_CONFIG } from "../src/config";
import { planTick, runTick } from "../src/tick";
import { toJst } from "../src/time";
import { TOKYO, at, makeServices, nowcast, sampleForecast, storeSettings } from "./helpers";

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

  it("地点が未設定なら急な雨チェックをしない", () => {
    expect(planTick(settings({ location: null }), null, toJst(at(14, 0))).rain).toBe(false);
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
    expect(await getMorningFlag(s.kv, "2026-10-10")).toBe("sent");
  });

  it("同じ日に2回は送らない", async () => {
    const s = makeServices();
    await storeSettings(s.kv, {});
    await runTick(s, at(7, 0));
    await runTick(s, at(7, 10));
    expect(s.line.pushes).toHaveLength(1);
  });

  it("地点が未設定なら設定方法を案内する", async () => {
    const s = makeServices();
    await runTick(s, at(7, 0));
    expect(s.line.pushes[0]).toContain("地点がまだ設定されていません");
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
    expect(await getMorningFlag(s.kv, "2026-10-10")).toBeNull();
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
