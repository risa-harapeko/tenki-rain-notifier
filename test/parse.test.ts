import { describe, expect, it } from "vitest";
import { normalizeText, parseCommand } from "../src/commands/parse";

describe("normalizeText", () => {
  it("全角数字・全角コロン・全角スペースを半角にする", () => {
    expect(normalizeText("朝　６：３０")).toBe("朝 6:30");
  });
  it("前後の空白を除き、連続する空白をまとめる", () => {
    expect(normalizeText("  地点   渋谷区 ")).toBe("地点 渋谷区");
  });
});

describe("parseCommand", () => {
  it.each([
    ["地点 渋谷区", "location", "渋谷区"],
    ["地点　渋谷区", "location", "渋谷区"],
    ["地点：渋谷区", "location", "渋谷区"],
    ["地点:渋谷区", "location", "渋谷区"],
    ["地点", "location", ""],
    ["朝 6:30", "morning", "6:30"],
    ["朝の通知 6:30", "morning", "6:30"],
    ["時刻 ６時半", "morning", "6時半"],
    ["朝", "morning", ""],
    ["雨 7-22", "rain", "7-22"],
    ["雨通知 7-22", "rain", "7-22"],
    ["雨の通知：7〜22", "rain", "7〜22"],
    ["雨", "rain", ""],
    ["設定", "settings", ""],
    ["ヘルプ", "help", ""],
    ["使い方", "help", ""],
    ["HELP", "help", ""],
  ])("%s → %s (%s)", (text, type, arg) => {
    expect(parseCommand(text)).toEqual({ type, arg });
  });

  it.each(["こんにちは", "雨すごい", "地点渋谷区", ""])("区切りのないテキストや未知のテキスト「%s」は unknown", (text) => {
    expect(parseCommand(text).type).toBe("unknown");
  });
});
