// 地点の妥当性チェックと地点名の整形（spec.md 3.5.5）

const MAX_NAME_LENGTH = 30;

/** 急な雨の予測（Yahoo 気象情報API）が国内のみ対応のため、おおよその日本の範囲に限る */
export function isInJapan(lat: number, lon: number): boolean {
  return lat >= 20 && lat <= 46 && lon >= 122 && lon <= 154;
}

export function truncateName(name: string): string {
  return [...name].slice(0, MAX_NAME_LENGTH).join("");
}

/** LINE の位置情報メッセージから地点名を決める。title があればそれを、なければ住所を使う */
export function nameFromLocationMessage(title?: string, address?: string): string {
  const t = title?.trim();
  if (t) return truncateName(t);
  const a = (address ?? "")
    .replace(/^日本[、,]\s*/, "")
    .replace(/〒?\s*\d{3}-?\d{4}\s*/, "")
    .trim();
  return truncateName(a || "指定した地点");
}
