// WMO 天気コード → 日本語（spec.md 3.1.5）

const TABLE: [number[], string][] = [
  [[0], "快晴 ☀️"],
  [[1, 2], "晴れ時々くもり ⛅"],
  [[3], "くもり ☁️"],
  [[45, 48], "霧 🌫️"],
  [[51, 53, 55, 56, 57], "霧雨 🌦️"],
  [[61, 63, 80, 81], "雨 ☔"],
  [[65, 82], "強い雨 ☔"],
  [[66, 67], "着氷性の雨 🧊"],
  [[71, 73, 75, 77, 85, 86], "雪 ❄️"],
  [[95, 96, 99], "雷雨 ⛈️"],
];

export function describeWeather(code: number): string {
  for (const [codes, label] of TABLE) {
    if (codes.includes(code)) return label;
  }
  return "不明";
}
