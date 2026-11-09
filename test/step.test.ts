import { describe, expect, it } from "vitest";
import { COURSE_URL, type Observation } from "../src/detect";
import { capPending, EMPTY_STATE, MAX_PENDING, type Mail, type State, step } from "../src/step";
import { fetchFail, MINUTE, NOW, ok, shape, skip, suspect } from "./helpers";

const STARTED = "isitopen started";
const TUESDAY = Date.parse("2026-11-10T06:00:00.000Z");
const at = (n: number) => TUESDAY + n * 15 * MINUTE;

function play(observations: Observation[], from: State | null = null) {
  let state = from;
  const sent: Mail[][] = [];
  for (const obs of observations) {
    const { next, mails } = step(state, obs);
    state = next;
    sent.push(mails.filter((m) => !m.subject.startsWith(STARTED)));
  }
  return { state: state as State, sent, subjects: sent.map((m) => m.map((x) => x.subject)) };
}

const seed = (status: "CLOSED" | "ANNOUNCED" | "OPEN") => step(null, ok(status, at(0))).next;
const failing = (subjects: string[][]) => subjects.flat().filter((s) => s.includes("failing"));

describe("status transitions", () => {
  it("sends one started mail with the status on the first run", () => {
    const { next, mails } = step(null, ok("OPEN", at(0)));
    expect(mails.map((m) => m.subject)).toEqual(["isitopen started: current status OPEN"]);
    expect(mails[0].body).toContain(`Course: ${COURSE_URL}`);
    expect(next.status).toBe("OPEN");
  });

  it("sends the started mail once, also when the first runs failed", () => {
    const failed = step(null, shape(at(0)));
    const first = step(failed.next, ok("ANNOUNCED", at(1)));
    expect(first.mails.map((m) => m.subject)).toEqual([
      "isitopen started: current status ANNOUNCED",
    ]);
    expect(step(first.next, ok("ANNOUNCED", at(2))).mails).toEqual([]);
  });

  it("mails CLOSED to ANNOUNCED with the date in WIB", () => {
    const { mails } = step(seed("CLOSED"), ok("ANNOUNCED", at(1)));
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("SE Career opens on 12 Dec");
    expect(mails[0].body).toContain("2026-12-12 10:00 WIB");
  });

  it("mails CLOSED to OPEN", () => {
    const { mails } = step(seed("CLOSED"), ok("OPEN", at(1)));
    expect(mails.map((m) => m.subject)).toEqual(["SE Career is OPEN"]);
  });

  it("mails ANNOUNCED to OPEN", () => {
    const { mails } = step(seed("ANNOUNCED"), ok("OPEN", at(1)));
    expect(mails.map((m) => m.subject)).toEqual(["SE Career is OPEN"]);
  });

  it.each(["OPEN", "ANNOUNCED"] as const)("mails %s back to CLOSED", (from) => {
    const { mails } = step(seed(from), ok("CLOSED", at(1)));
    expect(mails.map((m) => m.subject)).toEqual(["SE Career is closed again"]);
  });

  it("mails OPEN to ANNOUNCED", () => {
    const { mails } = step(seed("OPEN"), ok("ANNOUNCED", at(1)));
    expect(mails.map((m) => m.subject)).toEqual(["SE Career opens on 12 Dec"]);
  });

  it("puts the course link and last observation in every mail", () => {
    const { mails } = step(seed("CLOSED"), ok("OPEN", at(1)));
    expect(mails[0].body).toContain(`Course: ${COURSE_URL}`);
    expect(mails[0].body).toContain("Status: OPEN");
    expect(mails[0].body).toContain("- Full payment: open");
    expect(mails[0].body).toContain("Last good check: 2026-11-10 13:15 WIB");
  });

  it("sends nothing twice across repeat runs", () => {
    const { subjects } = play([
      ok("CLOSED", at(0)),
      ok("ANNOUNCED", at(1)),
      ok("ANNOUNCED", at(2)),
      ok("ANNOUNCED", at(3)),
      ok("OPEN", at(4)),
      ok("OPEN", at(5)),
      ok("OPEN", at(6)),
    ]);
    expect(subjects).toEqual([
      [],
      ["SE Career opens on 12 Dec"],
      [],
      [],
      ["SE Career is OPEN"],
      [],
      [],
    ]);
  });

  it("stays quiet when the announced date changes", () => {
    const { mails, next } = step(
      seed("ANNOUNCED"),
      ok("ANNOUNCED", at(1), { opensAt: "2026-12-20T03:00:00.000Z" }),
    );
    expect(mails).toEqual([]);
    expect(next.opensAt).toBe("2026-12-20T03:00:00.000Z");
  });

  it("notifies again for the next cycle", () => {
    const { subjects } = play([
      ok("CLOSED", at(0)),
      ok("OPEN", at(1)),
      ok("CLOSED", at(2)),
      ok("OPEN", at(3)),
    ]);
    expect(subjects.flat()).toEqual([
      "SE Career is OPEN",
      "SE Career is closed again",
      "SE Career is OPEN",
    ]);
  });
});

describe("ended but opening set", () => {
  const flagged = (n: number) => ok("CLOSED", at(n), { endedButOpening: true });

  it("pings once", () => {
    const { subjects } = play([ok("CLOSED", at(0)), flagged(1), flagged(2)]);
    expect(subjects.flat()).toEqual(["isitopen: SE Career opening date set but end date passed"]);
  });

  it("pings again after it clears", () => {
    const { subjects } = play([flagged(0), ok("CLOSED", at(1)), flagged(2)]);
    expect(subjects.flat()).toHaveLength(2);
  });
});

describe("scheme ids", () => {
  const withIds = (ids: string[], n: number) =>
    ok("CLOSED", at(n), {
      schemes: ids.map((id) => ({
        id,
        title: id,
        state: "closed" as const,
        opensAt: null,
        endedButOpening: false,
      })),
    });

  it("pings when the set changes", () => {
    const { subjects } = play([
      withIds(["a", "b"], 0),
      withIds(["a", "c"], 1),
      withIds(["a", "c"], 2),
    ]);
    expect(subjects.flat()).toEqual(["isitopen: SE Career price schemes changed"]);
  });

  it("ignores order", () => {
    const { subjects } = play([withIds(["a", "b"], 0), withIds(["b", "a"], 1)]);
    expect(subjects.flat()).toEqual([]);
  });
});

describe("shape errors", () => {
  it("alerts on the second run in a row, once", () => {
    const { subjects, state } = play([
      ok("CLOSED", at(0)),
      shape(at(1)),
      shape(at(2)),
      shape(at(3)),
      shape(at(4)),
    ]);
    expect(subjects.slice(1)).toEqual([[], ["isitopen: checker failing since 13:15 WIB"], [], []]);
    expect(state.status).toBe("CLOSED");
    expect(state.checkedAt).toBe(at(0));
  });

  it("sends one recovered mail", () => {
    const { subjects } = play([
      shape(at(0)),
      shape(at(1)),
      ok("CLOSED", at(2)),
      ok("CLOSED", at(3)),
    ]);
    expect(subjects.flat()).toEqual([
      "isitopen: checker failing since 13:00 WIB",
      "isitopen: checker recovered",
    ]);
  });

  it("does not alert when a good check breaks the streak", () => {
    const { subjects } = play([
      shape(at(0)),
      ok("CLOSED", at(1)),
      shape(at(2)),
      ok("CLOSED", at(3)),
    ]);
    expect(subjects.flat()).toEqual([]);
  });

  it("never changes status", () => {
    const { state } = play([ok("OPEN", at(0)), shape(at(1)), shape(at(2))]);
    expect(state.status).toBe("OPEN");
  });

  it("alerts again for a new incident", () => {
    const { subjects } = play([
      shape(at(0)),
      shape(at(1)),
      ok("CLOSED", at(2)),
      shape(at(3)),
      shape(at(4)),
    ]);
    expect(subjects.flat().filter((s) => s.includes("failing"))).toHaveLength(2);
  });

  it("includes the reason in the alert", () => {
    const { sent } = play([shape(at(0), "no priceScheme"), shape(at(1), "no priceScheme")]);
    expect(sent[1][0].body).toContain("no priceScheme");
  });
});

describe("fetch failures", () => {
  it("alerts after 24 in a row", () => {
    const runs = Array.from({ length: 25 }, (_, i) => fetchFail(at(i)));
    const { subjects } = play(runs);
    expect(subjects.slice(0, 23).flat()).toEqual([]);
    expect(subjects[23]).toEqual(["isitopen: checker failing since 13:00 WIB"]);
    expect(subjects[24]).toEqual([]);
  });

  it("recovers", () => {
    const runs = [...Array.from({ length: 24 }, (_, i) => fetchFail(at(i))), ok("CLOSED", at(24))];
    const { subjects } = play(runs);
    expect(subjects[24]).toEqual(["isitopen: checker recovered"]);
  });

  it("alternating shape and fetch failures alert on the second run", () => {
    const { subjects } = play([
      ok("CLOSED", at(0)),
      fetchFail(at(1)),
      shape(at(2)),
      fetchFail(at(3)),
    ]);
    expect(subjects.slice(1)).toEqual([[], ["isitopen: checker failing since 13:15 WIB"], []]);
  });

  it("a shape error then a fetch failure alerts on the fetch run", () => {
    const { subjects } = play([ok("CLOSED", at(0)), shape(at(1)), fetchFail(at(2))]);
    expect(subjects.slice(1)).toEqual([[], ["isitopen: checker failing since 13:15 WIB"]]);
  });

  it("keeps 24 runs for a fetch-only streak", () => {
    const { subjects } = play(Array.from({ length: 23 }, (_, i) => fetchFail(at(i))));
    expect(failing(subjects)).toEqual([]);
  });
});

describe("skipped runs", () => {
  const skips = (n: number) => Array.from({ length: n }, (_, i) => skip(at(i + 1)));

  it("keeps status and last check", () => {
    const { state } = play([ok("CLOSED", at(0)), skip(at(1))]);
    expect(state.status).toBe("CLOSED");
    expect(state.checkedAt).toBe(at(0));
  });

  it("stays quiet for 7 skipped runs", () => {
    const { subjects } = play([ok("CLOSED", at(0)), ...skips(7)]);
    expect(subjects.flat()).toEqual([]);
  });

  it("alerts once on the 8th skipped run in a row", () => {
    const { subjects, sent } = play([ok("CLOSED", at(0)), ...skips(10)]);
    expect(subjects[8]).toEqual(["isitopen: checker failing since 13:15 WIB"]);
    expect(failing(subjects)).toHaveLength(1);
    expect(sent[8][0].body).toContain("429 or 503");
    expect(sent[8][0].body).toContain("in a row: 8");
  });

  it("sends one recovered mail after the alert", () => {
    const { subjects } = play([ok("CLOSED", at(0)), ...skips(8), ok("CLOSED", at(9))]);
    expect(subjects[9]).toEqual(["isitopen: checker recovered"]);
  });

  it("a good check resets the count", () => {
    const { subjects } = play([ok("CLOSED", at(0)), ...skips(7), ok("CLOSED", at(8)), ...skips(7)]);
    expect(subjects.flat()).toEqual([]);
  });

  it("shares one alert per incident with failures", () => {
    const { subjects } = play([ok("CLOSED", at(0)), ...skips(8), shape(at(9)), shape(at(10))]);
    expect(failing(subjects)).toHaveLength(1);
  });
});

describe("button check failed with data saying open", () => {
  it("mails at once for OPEN, with the reason and the course link", () => {
    const { sent } = play([ok("CLOSED", at(0)), suspect("OPEN", at(1))]);
    expect(sent[1].map((m) => m.subject)).toEqual(["SE Career may be OPEN (button check failed)"]);
    expect(sent[1][0].body).toContain("0 buttons for 2 schemes");
    expect(sent[1][0].body).toContain(`Course: ${COURSE_URL}`);
  });

  it("mails at once for ANNOUNCED with the date", () => {
    const { sent } = play([ok("CLOSED", at(0)), suspect("ANNOUNCED", at(1))]);
    expect(sent[1][0].subject).toBe("SE Career may have an opening date (button check failed)");
    expect(sent[1][0].body).toContain("2026-12-12 10:00 WIB");
  });

  it("mails once per incident, then the generic alert, then recovery and the real OPEN mail", () => {
    const { subjects } = play([
      ok("CLOSED", at(0)),
      suspect("OPEN", at(1)),
      suspect("OPEN", at(2)),
      suspect("OPEN", at(3)),
      ok("OPEN", at(4)),
    ]);
    expect(subjects.slice(1)).toEqual([
      ["SE Career may be OPEN (button check failed)"],
      ["isitopen: checker failing since 13:15 WIB"],
      [],
      ["isitopen: checker recovered", "SE Career is OPEN"],
    ]);
  });

  it("mails again when the data moves from ANNOUNCED to OPEN", () => {
    const { subjects } = play([suspect("ANNOUNCED", at(0)), suspect("OPEN", at(1))]);
    expect(subjects[1]).toContain("SE Career may be OPEN (button check failed)");
  });

  it("does not repeat when the stored status already equals the data status", () => {
    const { subjects } = play([
      ok("CLOSED", at(0)),
      ok("OPEN", at(1)),
      suspect("OPEN", at(2)),
      ok("OPEN", at(3)),
      suspect("OPEN", at(4)),
      ok("OPEN", at(5)),
      suspect("OPEN", at(6)),
    ]);
    expect(subjects.flat().filter((s) => s.includes("may be OPEN"))).toEqual([]);
  });

  it("does not repeat for ANNOUNCED with the same date, but mails for a new date", () => {
    const moved = suspect("ANNOUNCED", at(4));
    if (moved.kind === "shape" && moved.data) moved.data.opensAt = "2027-01-01T03:00:00.000Z";
    const { subjects } = play([
      ok("ANNOUNCED", at(0)),
      suspect("ANNOUNCED", at(1)),
      ok("ANNOUNCED", at(2)),
      suspect("ANNOUNCED", at(3)),
      moved,
    ]);
    expect(subjects.flat().filter((s) => s.includes("opening date"))).toEqual([
      "SE Career may have an opening date (button check failed)",
    ]);
  });

  it("mails again for a new incident", () => {
    const { subjects } = play([
      ok("CLOSED", at(0)),
      suspect("OPEN", at(1)),
      ok("CLOSED", at(2)),
      suspect("OPEN", at(3)),
    ]);
    expect(subjects.flat().filter((s) => s.includes("may be OPEN"))).toHaveLength(2);
  });

  it("leaves the stored status unchanged", () => {
    const { state } = play([ok("CLOSED", at(0)), suspect("OPEN", at(1))]);
    expect(state.status).toBe("CLOSED");
    expect(state.checkedAt).toBe(at(0));
  });

  it("a plain shape error sends no may-be-open mail", () => {
    const { subjects } = play([ok("CLOSED", at(0)), shape(at(1))]);
    expect(subjects.flat()).toEqual([]);
  });
});

describe("pending cap", () => {
  const plain = (n: number): Mail => ({ subject: `plain ${n}`, body: "" });
  const status = (n: number): Mail => ({ subject: `status ${n}`, body: "", keep: true });

  it("keeps everything under the cap", () => {
    const mails = [plain(0), status(1)];
    expect(capPending(mails)).toEqual(mails);
  });

  it("drops the oldest mails over the cap", () => {
    const mails = Array.from({ length: MAX_PENDING + 3 }, (_, i) => plain(i));
    expect(capPending(mails).map((m) => m.subject)).toEqual(mails.slice(3).map((m) => m.subject));
  });

  it("never drops a status mail, even the oldest", () => {
    const mails = [status(0), ...Array.from({ length: MAX_PENDING + 3 }, (_, i) => plain(i + 1))];
    const kept = capPending(mails);
    expect(kept).toHaveLength(MAX_PENDING);
    expect(kept[0].subject).toBe("status 0");
    expect(kept.map((m) => m.subject)).not.toContain("plain 1");
  });

  it("keeps all status mails when they alone exceed the cap", () => {
    const mails = Array.from({ length: MAX_PENDING + 2 }, (_, i) => status(i));
    expect(capPending(mails)).toHaveLength(MAX_PENDING + 2);
  });

  it("marks the started mail only when the first status is OPEN or ANNOUNCED", () => {
    const keep = (status: "CLOSED" | "ANNOUNCED" | "OPEN") =>
      step(null, ok(status, at(0))).mails.map((m) => m.keep === true);
    expect(keep("OPEN")).toEqual([true]);
    expect(keep("ANNOUNCED")).toEqual([true]);
    expect(keep("CLOSED")).toEqual([false]);
  });

  it("marks OPEN, ANNOUNCED and may-be-open mails", () => {
    const flagged = (mails: Mail[]) => mails.map((m) => m.keep === true);
    expect(flagged(step(seed("CLOSED"), ok("OPEN", at(1))).mails)).toEqual([true]);
    expect(flagged(step(seed("CLOSED"), ok("ANNOUNCED", at(1))).mails)).toEqual([true]);
    expect(flagged(step(seed("CLOSED"), suspect("OPEN", at(1))).mails)).toEqual([true]);
    expect(flagged(step(seed("OPEN"), ok("CLOSED", at(1))).mails)).toEqual([false]);
  });
});

describe("heartbeat", () => {
  const monday = Date.parse("2026-11-09T13:45:00.000Z");
  const quietGood = (when: number) => ({
    ...step(null, ok("CLOSED", when)).next,
    heartbeatDay: null,
  });

  it("sends on Monday WIB once per day", () => {
    const { subjects } = play([
      ok("CLOSED", monday),
      ok("CLOSED", monday + 15 * MINUTE),
      ok("CLOSED", monday + 7 * 24 * 3600_000),
    ]);
    expect(subjects).toEqual([["isitopen: weekly heartbeat"], [], ["isitopen: weekly heartbeat"]]);
  });

  it("follows the WIB day boundary", () => {
    const sundayNight = Date.parse("2026-11-08T16:59:00.000Z");
    const mondayStart = Date.parse("2026-11-08T17:00:00.000Z");
    expect(step(seed("CLOSED"), ok("CLOSED", sundayNight)).mails).toEqual([]);
    expect(step(seed("CLOSED"), ok("CLOSED", mondayStart)).mails).toHaveLength(1);
  });

  it("sends on other weekdays never", () => {
    expect(step(seed("CLOSED"), ok("CLOSED", TUESDAY)).mails).toEqual([]);
  });

  it("sends even when the check fails or is skipped", () => {
    expect(step(null, fetchFail(monday)).mails).toHaveLength(1);
    expect(step(null, skip(monday)).mails).toHaveLength(1);
  });

  it("says how long ago the last good check was", () => {
    const { mails } = step(seed("CLOSED"), ok("CLOSED", monday));
    expect(mails[0].subject).toBe("isitopen: weekly heartbeat");
    expect(mails[0].body).toContain("Last good check was 0 min ago.");
  });

  it("stays plain at exactly 1 h", () => {
    const good = quietGood(monday - 60 * MINUTE);
    expect(step(good, skip(monday)).mails[0].subject).toBe("isitopen: weekly heartbeat");
  });

  it("adds STALE to the subject when the last good check is over 1 h old", () => {
    const good = quietGood(monday - 61 * MINUTE);
    const { mails } = step(good, skip(monday));
    expect(mails[0].subject).toBe("isitopen: weekly heartbeat (STALE)");
    expect(mails[0].body).toContain("Last good check was 1 h ago.");
  });

  it("says so when there was never a good check", () => {
    const { mails } = step(null, fetchFail(monday));
    expect(mails[0].subject).toBe("isitopen: weekly heartbeat (STALE)");
    expect(mails[0].body).toContain("No good check yet.");
  });

  it("reports a week of skipped runs as stale", () => {
    const good = quietGood(monday - 7 * 24 * 60 * MINUTE);
    const { mails } = step(good, skip(monday));
    expect(mails[0].subject).toBe("isitopen: weekly heartbeat (STALE)");
    expect(mails[0].body).toContain("168 h ago");
  });

  it("comes after the status mail", () => {
    const { mails } = step(seed("CLOSED"), ok("OPEN", monday));
    expect(mails.map((m) => m.subject)).toEqual([
      "SE Career is OPEN",
      "isitopen: weekly heartbeat",
    ]);
  });
});

describe("purity", () => {
  it("does not mutate its inputs", () => {
    const prev = seed("CLOSED");
    const copy = structuredClone(prev);
    step(prev, ok("OPEN", at(1)));
    step(prev, shape(at(1)));
    step(prev, suspect("OPEN", at(1)));
    step(prev, skip(NOW));
    step(null, skip(NOW));
    expect(prev).toEqual(copy);
    expect(EMPTY_STATE.heartbeatDay).toBeNull();
  });
});
