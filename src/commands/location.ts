// 地点の妥当性チェック・地点名の整形・保存する情報の最小化（spec.md 3.5.5）

import { normalizeText } from "./parse";

const MAX_NAME_LENGTH = 30;
/** 緯度経度を丸める桁数。小数第2位でおよそ1km */
const COORD_DECIMALS = 2;

export const UNKNOWN_PLACE_NAME = "指定した地点";

/** 急な雨の予測（Yahoo 気象情報API）が国内のみ対応のため、おおよその日本の範囲に限る */
export function isInJapan(lat: number, lon: number): boolean {
  return lat >= 20 && lat <= 46 && lon >= 122 && lon <= 154;
}

export function truncateName(name: string): string {
  return [...name].slice(0, MAX_NAME_LENGTH).join("");
}

/** 詳しい位置を持たないよう、緯度経度を約1km単位に丸める */
export function roundCoord(value: number): number {
  const f = 10 ** COORD_DECIMALS;
  return Math.round(value * f) / f;
}

const PREFECTURE = /^(東京都|北海道|(?:京都|大阪)府|[^\s\d]{2,3}県)/;
// 郡（任意）＋市区町村、政令指定都市なら続く区まで。番地などの数字は含めない
const MUNICIPALITY = /^((?:[^\s\d]{1,5}郡)?[^\s\d]{1,6}?[市区町村])((?:[^\s\d]{1,4}?区)?)/;

/**
 * 住所の文字列を「都道府県＋市区町村」までに短くする（リバースジオコーダが使えないときの予備）。
 * 例: 日本、〒150-0002 東京都渋谷区渋谷2丁目21-1 → 東京都渋谷区
 * 市区町村名の途中に「市・町・村・区」を含む名前（例: 四日市市）は途中で切れることがある。
 */
export function shortenAddress(address: string | undefined): string | null {
  if (!address) return null;
  const s = normalizeText(address)
    .replace(/^日本[、,]\s*/, "")
    .replace(/〒?\s*\d{3}-?\d{4}\s*/, "")
    .replace(/\s/g, "");
  const pref = PREFECTURE.exec(s)?.[1] ?? "";
  const muni = MUNICIPALITY.exec(s.slice(pref.length));
  if (!muni) return null;
  return truncateName(pref + muni[1] + muni[2]);
}
