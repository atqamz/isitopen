import { COURSE_URL, type Observation, type Scheme, type Status } from "./detect";
import { isWibMonday, wibDate, wibDay, wibStamp, wibTime } from "./time";

export interface Mail {
  subject: string;
  body: string;
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
  shapeFails: number;
  fetchFails: number;
  failSince: number | null;
  lastFailure: string | null;
  alerted: boolean;
  heartbeatDay: string | null;
  pending: Mail[];
}

export const SHAPE_ALERT_AFTER = 2;
export const FETCH_ALERT_AFTER = 24;
export const MAX_PENDING = 20;

export const EMPTY_STATE: State = {
  status: null,
  opensAt: null,
  checkedAt: null,
  last: null,
  schemeIds: null,
  endedButOpening: false,
  shapeFails: 0,
  fetchFails: 0,
  failSince: null,
  lastFailure: null,
  alerted: false,
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

function statusMail(next: State): Mail {
  if (next.status === "OPEN") return mail("SE Career is OPEN", ["Registration is open."], next);
  if (next.status === "ANNOUNCED") {
    const at = Date.parse(next.opensAt as string);
    return mail(`SE Career opens on ${wibDay(at)}`, [`Registration opens ${wibStamp(at)}.`], next);
  }
  return mail("SE Career is closed again", ["Registration is closed."], next);
}

function heartbeat(prev: State, at: number): Pick<State, "heartbeatDay"> | null {
  const day = wibDate(at);
  return isWibMonday(at) && prev.heartbeatDay !== day ? { heartbeatDay: day } : null;
}

function failure(prev: State, obs: Observation & { kind: "shape" | "fetch" }) {
  const shape = obs.kind === "shape";
  const next: State = {
    ...prev,
    shapeFails: shape ? prev.shapeFails + 1 : 0,
    fetchFails: shape ? 0 : prev.fetchFails + 1,
    failSince: prev.failSince ?? obs.at,
    lastFailure: obs.reason,
  };
  const count = shape ? next.shapeFails : next.fetchFails;
  const limit = shape ? SHAPE_ALERT_AFTER : FETCH_ALERT_AFTER;
  const mails: Mail[] = [];
  if (count >= limit && !prev.alerted) {
    next.alerted = true;
    mails.push(
      mail(
        `isitopen: checker failing since ${wibTime(next.failSince as number)} WIB`,
        [
          `${shape ? "Page shape error" : "Fetch failure"}: ${obs.reason}`,
          `Runs in a row: ${count}`,
        ],
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
    shapeFails: 0,
    fetchFails: 0,
    failSince: null,
    lastFailure: null,
    alerted: false,
  };
  const mails: Mail[] = [];
  if (prev.alerted) {
    mails.push(mail("isitopen: checker recovered", ["Checks are good again."], next));
  }
  if (!first && prev.status !== obs.status) mails.push(statusMail(next));
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
  const result =
    obs.kind === "ok"
      ? success(before, obs)
      : obs.kind === "skip"
        ? { next: before, mails: [] as Mail[] }
        : failure(before, obs);
  const next = { ...result.next };
  const mails = [...result.mails];
  const beat = heartbeat(before, obs.at);
  if (beat) {
    Object.assign(next, beat);
    mails.push(mail("isitopen: weekly heartbeat", ["Checker is running."], next));
  }
  return { next, mails };
}
