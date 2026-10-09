import { describe, expect, it } from "vitest";
import { parseMorningTime, parseRainHours, planMorningChange, toStoredTime } from "../src/commands/schedule";
import { toJst } from "../src/time";
import { at } from "./helpers";

describe("parseMorningTime", () => {
  it.each([
    ["6:30", 390],
    ["06:30", 390],
    ["６：３０", 390],
    ["6時30分", 390],
    ["6時30", 390],
    ["6時半", 390],
    ["7時", 420],
    ["4:00", 240],
    ["11:50", 710],
  ])("%s を受け付ける", (input, minutes) => {
    expect(parseMorningTime(input)).toEqual({ ok: true, value: minutes });
  });

  it.each(["3:50", "12:00", "6:35", "25:00", "6:60", "abc", "", "6", "6:3"])("%s は受け付けない", (input) => {
    expect(parseMorningTime(input).ok).toBe(false);
  });

  it("保存用の形式は HH:MM", () => {
    expect(toStoredTime(390)).toBe("06:30");
  });
});

describe("parseRainHours", () => {
  it.each([
    ["7-22", 7, 22],
    ["7時〜22時", 7, 22],
    ["7～22", 7, 22],
    ["7 - 22", 7, 22],
    ["0-24", 0, 24],
  ])("%s を受け付ける", (input, start, end) => {
    expect(parseRainHours(input)).toEqual({ ok: true, value: { start, end } });
  });

  it.each(["22-7", "7-7", "7-25", "-1-5", "7", "朝-夜"])("%s は受け付けない", (input) => {
    expect(parseRainHours(input).ok).toBe(false);
  });
});

describe("planMorningChange", () => {
  it("新しい時刻より前で未送信なら今日から", () => {
    expect(planMorningChange(390, toJst(at(6, 0)), false)).toEqual({ skipToday: false, nextIsToday: true });
  });
  it("新しい時刻を過ぎていて未送信なら、今日は送らず明日から", () => {
    expect(planMorningChange(390, toJst(at(6, 30)), false)).toEqual({ skipToday: true, nextIsToday: false });
  });
  it("今日がすでに送信済みなら明日から", () => {
    expect(planMorningChange(600, toJst(at(8, 0)), true)).toEqual({ skipToday: false, nextIsToday: false });
  });
});
