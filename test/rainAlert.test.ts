import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config";
import { evaluateRain, hasQuotaForAlert, runRainAlert } from "../src/jobs/rainAlert";
import type { RainState } from "../src/state";
import { INITIAL_RAIN_STATE, getRainState, getSettings } from "../src/state";
import { toJst, toJstIso } from "../src/time";
import { classifyRain } from "../src/weather/rainLevel";
import { parseWeatherList } from "../src/weather/yahoo";
import { FakeLine, at, makeServices, nowcast, storeSettings } from "./helpers";

const rules = DEFAULT_CONFIG;
const NOW = at(14);

function state(overrides: Partial<RainState> = {}): RainState {
  return { ...INITIAL_RAIN_STATE, ...overrides };
}

describe("classifyRain", () => {
  it.each([
    [0.9, null],
    [1, "light"],
    [2.9, "light"],
    [3, "rain"],
    [9.9, "rain"],
    [10, "moderate"],
    [20, "heavy"],
    [29.9, "heavy"],
    [30, "intense"],
  ])("%f mm/h → %s", (mm, level) => {
    expect(classifyRain(mm, 1)).toBe(level);
  });
});

describe("evaluateRain", () => {
  it("60分以内に降り出すなら通知する", () => {
    const d = evaluateRain(state(), nowcast(0, [0, 2, 5, 3, 0, 0]), NOW, rules);
    expect(d.action).toBe("notify");
    expect(d.onset?.time).toBe(NOW + 20 * 60_000);
    expect(d.peak).toBe(5);
    expect(d.next).toEqual({ count: 1, raining: true, lastNotifiedAt: toJstIso(NOW), lastLevel: "rain" });
  });

  it("雨の予報がなければ通知しない", () => {
    expect(evaluateRain(state(), nowcast(0, [0, 0.5, 0, 0, 0, 0]), NOW, rules).action).toBe("none");
  });

  it("雨の最中は同じ雨について通知しない", () => {
    const d = evaluateRain(state({ raining: true, count: 1, lastLevel: "rain" }), nowcast(3, [3, 3, 3, 3, 3, 3]), NOW, rules);
    expect(d.action).toBe("none");
  });

  it("降雨中に初めて検知した場合は通知せず、雨の最中として記録する", () => {
    const d = evaluateRain(state(), nowcast(4, [4, 4, 0, 0, 0, 0]), NOW, rules);
    expect(d.action).toBe("none");
    expect(d.base).toMatchObject({ raining: true, count: 0, lastLevel: "rain" });
  });

  it("1日3回に達したら通知しない", () => {
    const d = evaluateRain(state({ count: 3 }), nowcast(0, [5, 5, 5, 5, 5, 5]), NOW, rules);
    expect(d.action).toBe("none");
  });

  it("クールダウン中（前回から60分未満）は通知しない", () => {
    const prev = state({ count: 1, lastNotifiedAt: toJstIso(NOW - 50 * 60_000) });
    expect(evaluateRain(prev, nowcast(0, [5, 0, 0, 0, 0, 0]), NOW, rules).action).toBe("none");
  });

  it("クールダウンが明けていれば通知する", () => {
    const prev = state({ count: 1, lastNotifiedAt: toJstIso(NOW - 60 * 60_000) });
    expect(evaluateRain(prev, nowcast(0, [5, 0, 0, 0, 0, 0]), NOW, rules).action).toBe("notify");
  });

  it("雨が止んで予報もなくなったら、雨の最中の状態をリセットする", () => {
    const d = evaluateRain(state({ raining: true, count: 1 }), nowcast(0, [0, 0, 0, 0, 0, 0]), NOW, rules);
    expect(d.base.raining).toBe(false);
    expect(d.base.count).toBe(1);
  });

  it("雨の最中に強い雨が予想されたら、クールダウン中でも強調通知する", () => {
    const prev = state({ raining: true, count: 1, lastLevel: "rain", lastNotifiedAt: toJstIso(NOW - 10 * 60_000) });
    const d = evaluateRain(prev, nowcast(5, [5, 10, 35, 20, 5, 0]), NOW, rules);
    expect(d.action).toBe("escalate");
    expect(d.onset?.time).toBe(NOW + 30 * 60_000);
    expect(d.next).toMatchObject({ count: 2, lastLevel: "intense" });
  });

  it("強調通知は同じ雨イベントで1回まで", () => {
    const prev = state({ raining: true, count: 2, lastLevel: "intense" });
    expect(evaluateRain(prev, nowcast(30, [40, 40, 40, 40, 40, 40]), NOW, rules).action).toBe("none");
  });

  it("最初から激しい雨の予想なら、新規通知が強調区分になる", () => {
    const d = evaluateRain(state(), nowcast(0, [0, 40, 50, 0, 0, 0]), NOW, rules);
    expect(d.action).toBe("notify");
    expect(d.peakLevel).toBe("intense");
  });
});

describe("hasQuotaForAlert", () => {
  const jst = toJst(at(14, 0, 10)); // 10月10日 → 残り22日（今日を含む）

  it("残り通数が残り日数より多ければ送る", async () => {
    const line = new FakeLine();
    line.quota = { limit: 200, used: 177 }; // 残り23
    expect(await hasQuotaForAlert(line, jst, 1)).toBe(true);
  });

  it("残り通数が残り日数以下なら送らない（朝の通知を優先）", async () => {
    const line = new FakeLine();
    line.quota = { limit: 200, used: 178 }; // 残り22
    expect(await hasQuotaForAlert(line, jst, 1)).toBe(false);
  });

  it("枠を取得できなければ送る", async () => {
    const line = new FakeLine();
    line.quota = null;
    expect(await hasQuotaForAlert(line, jst, 1)).toBe(true);
  });
});

describe("runRainAlert", () => {
  it("通知を送り、状態を保存する", async () => {
    const s = makeServices({ fetchNowcast: async () => nowcast(0, [0, 2, 5, 3, 0, 0]) });
    await storeSettings(s.kv, {});
    const r = await runRainAlert(s, "Uowner", await getSettings(s.kv, s.config, "Uowner"), NOW, 1);
    expect(r).toMatchObject({ action: "notify", sent: true });
    expect(s.line.pushes[0]).toContain("約20分後（14:20ごろ）");
    expect(s.line.pushes[0]).toContain("（本日の雨通知 1/3）");
    expect((await getRainState(s.kv, "Uowner", "2026-10-10")).count).toBe(1);
  });

  it("送信枠が足りなければ送らず、通知回数も増やさない", async () => {
    const s = makeServices({ fetchNowcast: async () => nowcast(0, [5, 5, 0, 0, 0, 0]) });
    s.line.quota = { limit: 200, used: 199 };
    await storeSettings(s.kv, {});
    const r = await runRainAlert(s, "Uowner", await getSettings(s.kv, s.config, "Uowner"), NOW, 1);
    expect(r.sent).toBe(false);
    expect(s.line.pushes).toHaveLength(0);
    expect((await getRainState(s.kv, "Uowner", "2026-10-10")).count).toBe(0);
  });

  it("状態が変わらなければ KV に書き込まない", async () => {
    const s = makeServices();
    await storeSettings(s.kv, {});
    const writesBefore = s.kv.writes;
    await runRainAlert(s, "Uowner", await getSettings(s.kv, s.config, "Uowner"), NOW, 1);
    expect(s.kv.writes).toBe(writesBefore);
  });
});

describe("parseWeatherList", () => {
  it("最新の観測値と予測値を時刻順に取り出す", () => {
    const n = parseWeatherList([
      { Type: "observation", Date: "202610101400", Rainfall: 0 },
      { Type: "forecast", Date: "202610101420", Rainfall: 2.5 },
      { Type: "forecast", Date: "202610101410", Rainfall: "0.65" },
    ]);
    expect(n.observation).toEqual({ time: at(14), rainfall: 0 });
    expect(n.forecasts).toEqual([
      { time: at(14, 10), rainfall: 0.65 },
      { time: at(14, 20), rainfall: 2.5 },
    ]);
  });
});
