import type { Env } from "./config";
import { createServices } from "./services";
import { runTick } from "./tick";
import { handleWebhook } from "./webhook";

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runTick(createServices(env), event.scheduledTime));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(request, createServices(env), (p) => ctx.waitUntil(p));
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
