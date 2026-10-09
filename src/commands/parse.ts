// LINE から届いたテキストの正規化とコマンド解析（spec.md 3.5.3 / 3.5.4）

export type CommandType = "location" | "morning" | "rain" | "settings" | "help";

export interface Command {
  type: CommandType | "unknown";
  /** キーワードの後ろの値（なければ空文字） */
  arg: string;
}

/** 全角英数字・記号を半角にし、空白を整える */
export function normalizeText(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ");
}

// 長いキーワードから順に照合する（「雨の通知」を「雨」より先に見る）
const KEYWORDS: [string, CommandType][] = (
  [
    ["朝の通知", "morning"],
    ["時刻", "morning"],
    ["朝", "morning"],
    ["雨の通知", "rain"],
    ["雨通知", "rain"],
    ["雨", "rain"],
    ["地点", "location"],
    ["設定", "settings"],
    ["ヘルプ", "help"],
    ["使い方", "help"],
    ["help", "help"],
  ] as [string, CommandType][]
).sort((a, b) => b[0].length - a[0].length);

export function parseCommand(text: string): Command {
  const normalized = normalizeText(text);
  const lower = normalized.toLowerCase();
  for (const [keyword, type] of KEYWORDS) {
    if (lower === keyword) return { type, arg: "" };
    if (!lower.startsWith(keyword)) continue;
    const rest = normalized.slice(keyword.length);
    // キーワードと値の区切りは空白か「:」（全角は正規化で半角になっている）
    if (/^[ :]/.test(rest)) {
      return { type, arg: rest.replace(/^[ :]+/, "").trim() };
    }
  }
  return { type: "unknown", arg: "" };
}
