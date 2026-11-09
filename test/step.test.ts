import { describe, expect, it } from "vitest";
import { COURSE_URL, type Observation } from "../src/detect";
import { EMPTY_STATE, type Mail, type State, step } from "../src/step";
import { fetchFail, MINUTE, NOW, ok, shape } from "./helpers";

const TUESDAY = Date.parse("2026-11-10T06:00:00.000Z");
const at = (n: number) => TUESDAY + n * 15 * MINUTE;

function play(observations: Observation[], from: State | null = null) {
  let state = from;
  const sent: Mail[][] = [];
  for (const obs of observations) {
    const { next, mails } = step(state, obs);
    state = next;
    sent.push(mails);
  }
  return { state: state as State, sent, subjects: sent.map((m) => m.map((x) => x.subject)) };
}

const seed = (status: "CLOSED" | "ANNOUNCED" | "OPEN") => step(null, ok(status, at(0))).next;

describe("status transitions", () => {
  it("sends nothing on the first run", () => {
    const { next, mails } = step(null, ok("OPEN", at(0)));
    expect(mails).toEqual([]);
    expect(next.status).toBe("OPEN");
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

  it("skips 429 and 503 without counting", () => {
    const { state, subjects } = play([ok("CLOSED", at(0)), { kind: "skip", at: at(1) }]);
    expect(state.fetchFails).toBe(0);
    expect(subjects.flat()).toEqual([]);
  });
});

describe("heartbeat", () => {
  const monday = Date.parse("2026-11-09T13:45:00.000Z");

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
    expect(step(null, fetchFail(monday)).mails.map((m) => m.subject)).toEqual([
      "isitopen: weekly heartbeat",
    ]);
    expect(step(null, { kind: "skip", at: monday }).mails).toHaveLength(1);
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
    step(prev, { kind: "skip", at: NOW });
    step(null, { kind: "skip", at: NOW });
    expect(prev).toEqual(copy);
    expect(EMPTY_STATE.heartbeatDay).toBeNull();
  });
});
