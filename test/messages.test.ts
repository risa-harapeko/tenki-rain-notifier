import { describe, expect, it } from "vitest";
import { morningMessage, rainAlertMessage } from "../src/notify/messages";
import { at } from "./helpers";

describe("morningMessage", () => {
  it("仕様書の形式で組み立てる", () => {
    const text = morningMessage(
      "東京都渋谷区",
      "10月10日(土)",
      { weatherCode: 1, tempMax: 24.4, tempMin: 15.6, precipProbMax: 40 },
      { level: "folding", maxProb: 40, totalPrecip: 0, rainStartHour: 15 },
    );
    expect(text).toBe(
      [
        "☀️ おはようございます！",
        "【東京都渋谷区】10月10日(土)の天気",
        "",
        "天気：晴れ時々くもり ⛅",
        "気温：最高 24℃ / 最低 16℃",
        "降水確率：40%",
        "",
        "🌂 折りたたみ傘があると安心です",
        "（15時ごろから雨の可能性）",
      ].join("\n"),
    );
  });

  it("傘不要", () => {
    const text = morningMessage(
      "東京都渋谷区",
      "10月10日(土)",
      { weatherCode: 0, tempMax: 24, tempMin: 16, precipProbMax: null },
      { level: "none", maxProb: 0, totalPrecip: 0, rainStartHour: null },
    );
    expect(text).toContain("降水確率：--");
    expect(text.endsWith("👍 傘は不要です")).toBe(true);
  });
});

describe("rainAlertMessage", () => {
  const base = { placeName: "東京都渋谷区", nowMs: at(14), count: 1, max: 3 };

  it("通常の雨", () => {
    const text = rainAlertMessage({ ...base, kind: "notify", onsetMs: at(14, 20), peak: 5, peakLevel: "rain" });
    expect(text).toBe(
      [
        "☔ まもなく雨が降りそうです",
        "【東京都渋谷区】",
        "",
        "降り始め：約20分後（14:20ごろ）",
        "予想される強さ：雨（最大 5mm/h）",
        "",
        "（本日の雨通知 1/3）",
        "Web Services by Yahoo! JAPAN",
      ].join("\n"),
    );
  });

  it("激しい雨は強調し、避難を促す", () => {
    const text = rainAlertMessage({ ...base, kind: "notify", onsetMs: at(14, 10), peak: 42.25, peakLevel: "intense" });
    expect(text.startsWith("🚨【激しい雨に注意】ゲリラ豪雨の恐れ")).toBe(true);
    expect(text).toContain("激しい雨（ゲリラ豪雨の恐れ）（最大 42.3mm/h）");
    expect(text).toContain("屋内への避難");
  });

  it("エスカレーションでは「雨が強まる時刻」と表示する", () => {
    const text = rainAlertMessage({ ...base, kind: "escalate", onsetMs: at(14, 30), peak: 25, peakLevel: "heavy", count: 2 });
    expect(text.startsWith("⚠️【強い雨に注意】")).toBe(true);
    expect(text).toContain("雨が強まる時刻：約30分後（14:30ごろ）");
    expect(text).toContain("（本日の雨通知 2/3）");
  });

  it("予想時刻が今なら「まもなく」", () => {
    const text = rainAlertMessage({ ...base, kind: "notify", onsetMs: at(14), peak: 2, peakLevel: "light" });
    expect(text).toContain("降り始め：まもなく");
  });
});
