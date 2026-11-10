# isitopen

Small personal checker on Cloudflare Workers. It watches a page for a closed-to-open change and emails its owner. Each watched page also gets a public status page.

Today it watches one page: https://course.lwastuargo.com/se-career, shown at https://isitopen.atqamz.com/se-career. Unofficial, not affiliated with @lwastuargo or the course.

The code supports one page. Tracking another page is a code change, see below.

## How it works

- A cron trigger (`*/15 * * * *`) fetches the page. The fetch times out after 10 s.
- `src/detect.ts` is page-specific. It turns the response into CLOSED, ANNOUNCED or OPEN, or into a shape error, a fetch failure or a skipped run. A page that no longer looks as expected is a shape error, never a status change.
- `src/step.ts` is a pure function from the previous state and an observation to the next state and the mails to send: status changes, one alert per incident plus a "recovered" mail, and a Monday heartbeat (WIB) that says "STALE" in the subject when the last good check is over 1 h old.
- `src/mail.ts` sends plain-text mail through the `send_email` binding. Failed sends are kept in state and retried on the next run.
- State is one Workers KV key per slug. No other storage, no runtime dependencies.
- `src/page.ts` renders the public status page for the slug.

## Track another page

Everything specific to se-career, and what to do with it:

- `src/detect.ts`: `COURSE_URL` and the detector, which reads this course's price data (`self.__next_f` chunks) and buttons. Write a detector for the new page that returns the same `Observation` shape.
- `src/index.ts`: `SLUG` (`se-career`) is the KV key and the URL path; `observe`, `run` and the `fetch` handler use one `SLUG` and one `COURSE_URL`. Turn them into a list of pages and loop `run` over it, one KV key and one route per slug.
- `src/step.ts`: mail subjects say "SE Career" and bodies link `COURSE_URL`. Take the page's name and URL as inputs.
- `src/page.ts`: title, question, description, the "Unofficial" footer and the link all hold se-career copy. Make them per page.
- `test/fixtures/se-career.*.html`: saved pages for each state. Add the same set for the new page (closed, announced, open, and the shape-error cases) and test its detector in `test/detect.test.ts`. Extend `test/worker.test.ts` for the new route and KV key.

Cost: each page adds one fetch, one KV read and one KV write per run, every 15 minutes. The Free plan allows 50 external subrequests and 1000 subrequests to Cloudflare services such as KV per invocation, and 10 ms CPU ([limits](https://developers.cloudflare.com/workers/platform/limits/)). A run costs about 6 ms CPU with one page, measured with `npx wrangler tail` on the first deployed cron run, 2026-11-10, so a second page in the same cron run is close to the limit. Measure with `npx wrangler tail` after adding one, or move to a separate cron or Worker.

## Develop

```
npm ci
npx biome check .
npx tsc --noEmit
npx vitest run
npx wrangler deploy --dry-run
```

## Deploy

The live deploy uses the cf CLI's atqamz login: wrangler runs with cf's OAuth token and the atqamz account id in `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The KV namespace exists and its id is in `wrangler.jsonc`. `EMAIL_TO` is a Worker secret. Keep the address and any token out of the repo.

For a new account:

- [ ] Enable Email Routing on `atqamz.com` and verify the destination address.
- [ ] `npx wrangler kv namespace create STATE`, then put the id into `kv_namespaces[0].id`.
- [ ] `npx wrangler secret put EMAIL_TO` with the verified address. Check `vars.EMAIL_FROM` is on `atqamz.com`.
- [ ] `npx wrangler deploy` (creates the `isitopen.atqamz.com` custom domain and the cron).
- [ ] Verify: the status page loads; `npx wrangler tail` shows a run within 15 minutes; the "isitopen started: current status ..." mail arrives on the first good run, which proves the mail path.

The open-state markup of se-career has never been seen. Check the first real opening by hand.
