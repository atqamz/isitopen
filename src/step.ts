import { COURSE_URL, type Observation, type Scheme, type Status } from "./detect";
import { ago, isWibMonday, STALE_AFTER_MS, wibDate, wibDay, wibStamp, wibTime } from "./time";

export interface Mail {
  subject: string;
  body: string;
  keep?: boolean;
}

export interface Summary {
  status: Status;
  opensAt: string | null;
  schemes: Pick<Scheme, "title" | "state">[];
}

export interface State {
  status: Status | null;
  opensAt: string | null;
  checkedAt: number | null;
  last: Summary | null;
  schemeIds: string[] | null;
  endedButOpening: boolean;
  failStreak: number;
  shapeInStreak: boolean;
  skipStreak: number;
  failSince: number | null;
  lastFailure: string | null;
  alerted: boolean;
  suspect: "ANNOUNCED" | "OPEN" | null;
  heartbeatDay: string | null;
  pending: Mail[];
}

export const SHAPE_ALERT_AFTER = 2;
export const FETCH_ALERT_AFTER = 24;
export const SKIP_ALERT_AFTER = 8;
export const MAX_PENDING = 20;

export const EMPTY_STATE: State = {
  status: null,
  opensAt: null,
  checkedAt: null,
  last: null,
  schemeIds: null,
  endedButOpening: false,
  failStreak: 0,
  shapeInStreak: false,
  skipStreak: 0,
  failSince: null,
  lastFailure: null,
  alerted: false,
  suspect: null,
  heartbeatDay: null,
  pending: [],
};

function describe(state: State): string {
  if (!state.last || state.checkedAt === null) return "Last observation: none yet.";
  const { status, opensAt, schemes } = state.last;
  return [
    `Last good check: ${wibStamp(state.checkedAt)}`,
    `Status: ${status}${opensAt ? ` (opens ${wibStamp(Date.parse(opensAt))})` : ""}`,
    ...schemes.map((s) => `- ${s.title}: ${s.state}`),
  ].join("\n");
}

const mail = (subject: string, lines: string[], state: State): Mail => ({
  subject,
  body: [...lines, "", `Course: ${COURSE_URL}`, "", describe(state), ""].join("\n"),
});

const urgent = (m: Mail): Mail => ({ ...m, keep: true });

function statusMail(next: State): Mail {
  if (next.status === "OPEN")
    return urgent(mail("SE Career is OPEN", ["Registration is open."], next));
  if (next.status === "ANNOUNCED") {
    const at = Date.parse(next.opensAt as string);
    return urgent(
      mail(`SE Career opens on ${wibDay(at)}`, [`Registration opens ${wibStamp(at)}.`], next),
    );
  }
  return mail("SE Career is closed again", ["Registration is closed."], next);
}

export function capPending(mails: Mail[]): Mail[] {
  let drop = mails.length - MAX_PENDING;
  return mails.filter((m) => m.keep || drop-- <= 0);
}

function suspectMail(next: State, obs: Observation & { kind: "shape" }): Mail | null {
  const data = obs.data;
  if (!data || next.suspect === data.status) return null;
  next.suspect = data.status;
  const opensAt = data.opensAt ? Date.parse(data.opensAt) : null;
  return urgent(
    data.status === "OPEN"
      ? mail(
          "SE Career may be OPEN (button check failed)",
          [
            "The page data says registration is open, but the button check failed.",
            `Reason: ${obs.reason}`,
          ],
          next,
        )
      : mail(
          "SE Career may have an opening date (button check failed)",
          [
            `The page data says registration opens ${wibStamp(opensAt as number)}, but the button check failed.`,
            `Reason: ${obs.reason}`,
          ],
          next,
        ),
  );
}

function heartbeat(prev: State, at: number): Pick<State, "heartbeatDay"> | null {
  const day = wibDate(at);
  return isWibMonday(at) && prev.heartbeatDay !== day ? { heartbeatDay: day } : null;
}

function failure(prev: State, obs: Observation & { kind: "shape" | "fetch" | "skip" }) {
  const skip = obs.kind === "skip";
  const next: State = {
    ...prev,
    failStreak: skip ? prev.failStreak : prev.failStreak + 1,
    shapeInStreak: prev.shapeInStreak || obs.kind === "shape",
    skipStreak: skip ? prev.skipStreak + 1 : prev.skipStreak,
    failSince: prev.failSince ?? obs.at,
    lastFailure: skip ? "HTTP 429 or 503" : obs.reason,
  };
  const mails: Mail[] = [];
  const suspect = obs.kind === "shape" ? suspectMail(next, obs) : null;
  if (suspect) mails.push(suspect);
  const count = skip ? next.skipStreak : next.failStreak;
  const limit = skip
    ? SKIP_ALERT_AFTER
    : next.shapeInStreak
      ? SHAPE_ALERT_AFTER
      : FETCH_ALERT_AFTER;
  if (count >= limit && !prev.alerted) {
    next.alerted = true;
    const label = skip ? "Skipped runs" : next.shapeInStreak ? "Page shape error" : "Fetch failure";
    mails.push(
      mail(
        `isitopen: checker failing since ${wibTime(next.failSince as number)} WIB`,
        [`${label}: ${next.lastFailure}`, `${skip ? "Skipped runs" : "Runs"} in a row: ${count}`],
        next,
      ),
    );
  }
  return { next, mails };
}

function success(prev: State, obs: Observation & { kind: "ok" }) {
  const first = prev.status === null;
  const next: State = {
    ...prev,
    status: obs.status,
    opensAt: obs.opensAt,
    checkedAt: obs.at,
    last: {
      status: obs.status,
      opensAt: obs.opensAt,
      schemes: obs.schemes.map(({ title, state }) => ({ title, state })),
    },
    schemeIds: obs.schemes.map((s) => s.id).sort(),
    endedButOpening: obs.endedButOpening,
    failStreak: 0,
    shapeInStreak: false,
    skipStreak: 0,
    failSince: null,
    lastFailure: null,
    alerted: false,
    suspect: null,
  };
  const mails: Mail[] = [];
  if (prev.alerted) {
    mails.push(mail("isitopen: checker recovered", ["Checks are good again."], next));
  }
  if (first) {
    mails.push(
      mail(
        `isitopen started: current status ${obs.status}`,
        ["Checker started. This mail shows that email delivery works."],
        next,
      ),
    );
  } else if (prev.status !== obs.status) {
    mails.push(statusMail(next));
  }
  if (prev.schemeIds && prev.schemeIds.join() !== (next.schemeIds as string[]).join()) {
    mails.push(
      mail(
        "isitopen: SE Career price schemes changed",
        [`Was ${prev.schemeIds.length} scheme(s), now ${obs.schemes.length}.`],
        next,
      ),
    );
  }
  if (obs.endedButOpening && !prev.endedButOpening) {
    mails.push(
      mail(
        "isitopen: SE Career opening date set but end date passed",
        ["A scheme has a future opening date but its end date or quota already closed it."],
        next,
      ),
    );
  }
  return { next, mails };
}

export function step(prev: State | null, obs: Observation): { next: State; mails: Mail[] } {
  const before = prev ?? EMPTY_STATE;
  const result = obs.kind === "ok" ? success(before, obs) : failure(before, obs);
  const next = { ...result.next };
  const mails = [...result.mails];
  const beat = heartbeat(before, obs.at);
  if (beat) {
    Object.assign(next, beat);
    const stale = next.checkedAt === null || obs.at - next.checkedAt > STALE_AFTER_MS;
    mails.push(
      mail(
        `isitopen: weekly heartbeat${stale ? " (STALE)" : ""}`,
        [
          stale ? "Checker is running, but its last good check is stale." : "Checker is running.",
          next.checkedAt === null
            ? "No good check yet."
            : `Last good check was ${ago(obs.at - next.checkedAt)}.`,
        ],
        next,
      ),
    );
  }
  return { next, mails };
}
