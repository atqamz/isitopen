# isitopen

Unofficial checker for https://course.lwastuargo.com/se-career. A Cloudflare Worker polls the course page every 15 minutes, emails its owner when registration is announced, opens or closes again, and serves a public status page at https://isitopen.atqamz.com/se-career.

Unofficial, not affiliated with @lwastuargo or the course.

## How it works

- `src/detect.ts` reads the page's own price data (`self.__next_f` chunks, `"priceScheme":[`) and the rendered buttons, using the response `Date` header as `now`. A page that no longer looks like that is a shape error, never a status change.
- `src/step.ts` is a pure function from the previous state and an observation to the next state and the mails to send: status changes, one alert per incident plus one "recovered", an ended-but-opening-set ping, a scheme-id-change ping, and a Monday heartbeat (WIB).
- `src/mail.ts` sends plain-text mail through the `send_email` binding. A failed send is kept in state and retried on the next run.
- State is one Workers KV key (`se-career`). No other storage, no runtime dependencies.
- HTTP 429 and 503 skip the run. Network errors and other 5xx count as fetch failures (alert after 24 runs). Every other unexpected response counts as a shape error (alert after 2 runs).

## Develop

```
npm ci
npx biome check .
npx tsc --noEmit
npx vitest run
npx wrangler deploy --dry-run
```

## Deploy

Nothing here is deployed yet. `wrangler.jsonc` holds placeholders for the KV id and the operator address.

- [ ] Enable Email Routing on `atqamz.com` (adds MX and SPF records at the apex).
- [ ] Add the operator's destination address and verify it by clicking the mail Cloudflare sends.
- [ ] `npx wrangler kv namespace create STATE`, then put the id into `kv_namespaces[0].id`.
- [ ] Put the verified address into `vars.EMAIL_TO` and `send_email[0].destination_address`. Check `vars.EMAIL_FROM` is on `atqamz.com`.
- [ ] `npx wrangler deploy` (creates the `isitopen.atqamz.com` custom domain and the cron).
- [ ] Verify: the page loads; `npx wrangler tail` shows a run within 15 minutes with CPU time under the Free plan's 10 ms; the first Monday heartbeat mail arrives.

The open-state markup has never been seen. Check the first real opening by hand.
