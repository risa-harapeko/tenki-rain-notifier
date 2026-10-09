import { describe, expect, it } from "vitest";
import { geocode } from "../src/commands/geocode";
import { isInJapan, nameFromLocationMessage } from "../src/commands/location";

describe("isInJapan", () => {
  it.each([
    [35.66, 139.7, true],
    [20, 122, true],
    [46, 154, true],
    [19.99, 139, false],
    [46.01, 139, false],
    [35, 121.99, false],
    [35, 154.01, false],
    [37.77, -122.42, false],
  ])("(%f, %f) → %s", (lat, lon, expected) => {
    expect(isInJapan(lat, lon)).toBe(expected);
  });
});

describe("nameFromLocationMessage", () => {
  it("title があればそれを使う", () => {
    expect(nameFromLocationMessage("渋谷駅", "日本、〒150-0002 東京都渋谷区渋谷2丁目")).toBe("渋谷駅");
  });
  it("title がなければ住所から「日本、」と郵便番号を除く", () => {
    expect(nameFromLocationMessage(undefined, "日本、〒150-0002 東京都渋谷区渋谷2丁目")).toBe("東京都渋谷区渋谷2丁目");
  });
  it("30文字までに切り詰める", () => {
    expect([...nameFromLocationMessage("あ".repeat(40))].length).toBe(30);
  });
  it("何もなければ「指定した地点」", () => {
    expect(nameFromLocationMessage("", "")).toBe("指定した地点");
  });
});

describe("geocode", () => {
  const respond = (json: unknown) => async () => new Response(JSON.stringify(json));

  it("座標（経度,緯度）と地点名を返す", async () => {
    const result = await geocode(
      "渋谷区",
      "app",
      respond({ ResultInfo: { Count: 1 }, Feature: [{ Name: "東京都渋谷区", Geometry: { Coordinates: "139.6982,35.6640" } }] }),
    );
    expect(result).toEqual({ name: "東京都渋谷区", lat: 35.664, lon: 139.6982 });
  });

  it("見つからなければ null", async () => {
    expect(await geocode("しぶやく", "app", respond({ ResultInfo: { Count: 0 } }))).toBeNull();
  });

  it("HTTP エラーは例外", async () => {
    await expect(geocode("渋谷区", "app", async () => new Response("", { status: 500 }))).rejects.toThrow();
  });
});
