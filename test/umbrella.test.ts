import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config";
import { judgeUmbrella } from "../src/weather/umbrella";
import { describeWeather } from "../src/weather/weatherCode";
import { sampleForecast } from "./helpers";

const t = {
  probRequired: DEFAULT_CONFIG.umbrellaProbRequired,
  probFolding: DEFAULT_CONFIG.umbrellaProbFolding,
  precipRequired: DEFAULT_CONFIG.umbrellaPrecipRequired,
  hourPrecip: DEFAULT_CONFIG.umbrellaHourPrecip,
};

function probsAt(hour: number, prob: number): number[] {
  const probs = Array(24).fill(0);
  probs[hour] = prob;
  return probs;
}

describe("judgeUmbrella", () => {
  it("降水確率 50% で「必要」、降り始めの時刻を返す", () => {
    const r = judgeUmbrella(sampleForecast(probsAt(15, 50)).hourly, 7, 22, t);
    expect(r).toMatchObject({ level: "required", maxProb: 50, rainStartHour: 15 });
  });

  it("降水確率 49% は「折りたたみ推奨」", () => {
    expect(judgeUmbrella(sampleForecast(probsAt(15, 49)).hourly, 7, 22, t).level).toBe("folding");
  });

  it("降水確率 30% は「折りたたみ推奨」、29% は「不要」", () => {
    expect(judgeUmbrella(sampleForecast(probsAt(15, 30)).hourly, 7, 22, t)).toMatchObject({
      level: "folding",
      rainStartHour: 15,
    });
    expect(judgeUmbrella(sampleForecast(probsAt(15, 29)).hourly, 7, 22, t)).toMatchObject({
      level: "none",
      rainStartHour: null,
    });
  });

  it("確率が低くても合計降水量 1.0mm で「必要」", () => {
    const precips = Array(24).fill(0);
    precips[10] = 0.4;
    precips[11] = 0.6;
    const r = judgeUmbrella(sampleForecast(undefined, precips).hourly, 7, 22, t);
    expect(r).toMatchObject({ level: "required", totalPrecip: 1, rainStartHour: 11 });
  });

  it("合計 0.9mm なら「必要」にならない", () => {
    const precips = Array(24).fill(0);
    precips[10] = 0.9;
    expect(judgeUmbrella(sampleForecast(undefined, precips).hourly, 7, 22, t).level).toBe("none");
  });

  it("対象時間帯の外の雨は無視する", () => {
    expect(judgeUmbrella(sampleForecast(probsAt(5, 90)).hourly, 7, 22, t).level).toBe("none");
    expect(judgeUmbrella(sampleForecast(probsAt(22, 90)).hourly, 7, 22, t).level).toBe("none");
  });

  it("開始時刻は朝の通知時刻に合わせられる", () => {
    expect(judgeUmbrella(sampleForecast(probsAt(5, 90)).hourly, 5, 22, t).level).toBe("required");
  });

  it("null の値は 0 として扱う", () => {
    const forecast = sampleForecast();
    forecast.hourly.precipitationProbability = Array(24).fill(null);
    forecast.hourly.precipitation = Array(24).fill(null);
    expect(judgeUmbrella(forecast.hourly, 7, 22, t).level).toBe("none");
  });
});

describe("describeWeather", () => {
  it.each([
    [0, "快晴 ☀️"],
    [2, "晴れ時々くもり ⛅"],
    [63, "雨 ☔"],
    [95, "雷雨 ⛈️"],
    [12345, "不明"],
  ])("%i → %s", (code, label) => {
    expect(describeWeather(code)).toBe(label);
  });
});
