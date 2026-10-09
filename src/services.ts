// 外部とのやり取り（KV・LINE・天気API）をひとまとめにし、テストで差し替えられるようにする

import type { Config, Env } from "./config";
import { loadConfig } from "./config";
import type { GeocodeResult } from "./commands/geocode";
import { geocode } from "./commands/geocode";
import { defaultSleep } from "./http";
import type { LineApi } from "./notify/line";
import { LineClient } from "./notify/line";
import type { KvStore } from "./state";
import type { Forecast } from "./weather/openMeteo";
import { fetchForecast } from "./weather/openMeteo";
import type { Nowcast } from "./weather/yahoo";
import { fetchNowcast } from "./weather/yahoo";

export interface Services {
  kv: KvStore;
  config: Config;
  line: LineApi;
  userId: string;
  channelSecret: string;
  fetchForecast(lat: number, lon: number): Promise<Forecast>;
  fetchNowcast(lat: number, lon: number): Promise<Nowcast>;
  geocode(query: string): Promise<GeocodeResult | null>;
  sleep(ms: number): Promise<void>;
}

export function createServices(env: Env): Services {
  return {
    kv: env.STATE,
    config: loadConfig(env),
    line: new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN, env.LINE_USER_ID),
    userId: env.LINE_USER_ID,
    channelSecret: env.LINE_CHANNEL_SECRET,
    fetchForecast: (lat, lon) => fetchForecast(lat, lon),
    fetchNowcast: (lat, lon) => fetchNowcast(lat, lon, env.YAHOO_APP_ID),
    geocode: (query) => geocode(query, env.YAHOO_APP_ID),
    sleep: defaultSleep,
  };
}
