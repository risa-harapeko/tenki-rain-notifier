import { describe, expect, it } from "vitest";
import { geocode, reverseGeocode } from "../src/commands/geocode";
import { isInJapan, roundCoord, shortenAddress } from "../src/commands/location";

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

describe("shortenAddress", () => {
  it.each([
    ["日本、〒150-0002 東京都渋谷区渋谷２丁目２１−１", "東京都渋谷区"],
    ["日本、〒220-0012 神奈川県横浜市西区みなとみらい2-2-1", "神奈川県横浜市西区"],
    ["北海道札幌市中央区北1条西2丁目", "北海道札幌市中央区"],
    ["大阪府大阪市北区梅田1-1", "大阪府大阪市北区"],
    ["京都府京都市中京区寺町通", "京都府京都市中京区"],
    ["千葉県市川市八幡1-1", "千葉県市川市"],
    ["東京都府中市宮町1-1", "東京都府中市"],
    ["東京都町田市森野2-2", "東京都町田市"],
    ["長野県北佐久郡軽井沢町長倉1", "長野県北佐久郡軽井沢町"],
    ["横浜市西区みなとみらい", "横浜市西区"],
    ["東京都渋谷区", "東京都渋谷区"],
  ])("%s → %s", (address, expected) => {
    expect(shortenAddress(address)).toBe(expected);
  });

  it.each([undefined, "", "abc", "123-4567"])("市区町村がわからない「%s」は null", (address) => {
    expect(shortenAddress(address)).toBeNull();
  });
});

describe("roundCoord", () => {
  it("小数第2位（約1km）に丸める", () => {
    expect(roundCoord(35.658034)).toBe(35.66);
    expect(roundCoord(139.701636)).toBe(139.7);
    expect(roundCoord(-0.004)).toBe(-0);
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

describe("reverseGeocode", () => {
  const respond = (json: unknown) => async () => new Response(JSON.stringify(json));

  it("都道府県と市区町村だけを返し、大字・番地は含めない", async () => {
    const name = await reverseGeocode(
      35.66,
      139.7,
      "app",
      respond({
        Feature: [
          {
            Property: {
              AddressElement: [
                { Name: "東京都", Level: "prefecture" },
                { Name: "渋谷区", Level: "city" },
                { Name: "渋谷", Level: "oaza" },
                { Name: "2丁目", Level: "aza" },
                { Name: "21", Level: "detail1" },
              ],
            },
          },
        ],
      }),
    );
    expect(name).toBe("東京都渋谷区");
  });

  it("住所がわからなければ null", async () => {
    expect(await reverseGeocode(35.66, 139.7, "app", respond({ Feature: [] }))).toBeNull();
  });

  it("HTTP エラーは例外", async () => {
    await expect(reverseGeocode(35.66, 139.7, "app", async () => new Response("", { status: 500 }))).rejects.toThrow();
  });
});
