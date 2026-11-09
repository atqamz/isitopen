import { COURSE_URL, detect, type Observation } from "./detect";
import { type MailEnv, sendMail } from "./mail";
import { renderPage } from "./page";
import { MAX_PENDING, type State, step } from "./step";

export interface Env extends MailEnv {
  STATE: KVNamespace;
}

const SLUG = "se-career";
const USER_AGENT = "isitopen.atqamz.com status checker (+https://isitopen.atqamz.com)";

async function observe(): Promise<Observation> {
  const at = Date.now();
  try {
    const res = await fetch(COURSE_URL, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
    });
    return await detect(res, at);
  } catch (e) {
    return { kind: "fetch", at, reason: e instanceof Error ? e.message : "network error" };
  }
}

async function run(env: Env): Promise<void> {
  const prev = await env.STATE.get<State>(SLUG, "json");
  const { next, mails } = step(prev, await observe());
  const pending = [];
  for (const mail of [...(prev?.pending ?? []), ...mails]) {
    if (!(await sendMail(env, mail))) pending.push(mail);
  }
  await env.STATE.put(SLUG, JSON.stringify({ ...next, pending: pending.slice(-MAX_PENDING) }));
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const get = request.method === "GET" || request.method === "HEAD";
    if (get && url.pathname === "/") return Response.redirect(`${url.origin}/${SLUG}`, 302);
    if (get && url.pathname === `/${SLUG}`) {
      const state = await env.STATE.get<State>(SLUG, "json");
      return new Response(renderPage(state, Date.now()), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller, env): Promise<void> {
    await run(env);
  },
} satisfies ExportedHandler<Env>;
