# isitopen

Unofficial checker for https://course.lwastuargo.com/se-career. A Cloudflare Worker polls the course page every 15 minutes, emails its owner when registration is announced, opens or closes again, and serves a public status page at https://isitopen.atqamz.com/se-career.

Unofficial, not affiliated with @lwastuargo or the course.

## How it works

- `src/detect.ts` reads the page's own price data (`self.__next_f` chunks, `"priceScheme":[`) and the rendered buttons, using the response `Date` header as `now`. A page that no longer looks like that is a shape error, never a status change.
- `src/step.ts` is a pure function from the previous state and an observation to the next state and the mails to send: a "started" mail on the first good check, status changes, a "may be OPEN / may have an opening date (button check failed)" mail when the page data says open or announced but the button check fails, one alert per incident plus one "recovered", an ended-but-opening-set ping, a scheme-id-change ping, and a Monday heartbeat (WIB) that says how long ago the last good check was and carries "STALE" in the subject when that is over 1 h.
- `src/mail.ts` sends plain-text mail through the `send_email` binding. A failed send is kept in state and retried on the next run; at most 20 are kept, except the OPEN, ANNOUNCED and may-be-open mails, which are never dropped.
- State is one Workers KV key (`se-career`). No other storage, no runtime dependencies.
- The course fetch times out after 10 s. HTTP 429 and 503 skip the run and are counted: alert after 8 skipped runs in a row (2 h). Network errors, timeouts and other 5xx count as fetch failures (alert after 24 runs in a row). Every other unexpected response counts as a shape error (alert after 2 runs in a row). Shape and fetch failures share one streak: any shape error in it uses the 2-run limit.

## Develop

```
npm ci
npx biome check .
npx tsc --noEmit
npx vitest run
npx wrangler deploy --dry-run
```

## Deploy

Nothing here is deployed yet. `wrangler.jsonc` holds a placeholder for the KV id. The operator address is a Worker secret.

- [ ] Enable Email Routing on `atqamz.com` (adds MX and SPF records at the apex).
- [ ] Add the operator's destination address and verify it by clicking the mail Cloudflare sends.
- [ ] `npx wrangler kv namespace create STATE`, then put the id into `kv_namespaces[0].id`.
- [ ] `npx wrangler secret put EMAIL_TO` with the verified address. Check `vars.EMAIL_FROM` is on `atqamz.com`.
- [ ] `npx wrangler deploy` (creates the `isitopen.atqamz.com` custom domain and the cron).
- [ ] Verify: the page loads; `npx wrangler tail` shows a run within 15 minutes with CPU time under the Free plan's 10 ms; the "isitopen started: current status ..." mail arrives on the first good run, which proves the mail path.

The open-state markup has never been seen. Check the first real opening by hand.
