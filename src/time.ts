const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WIB_OFFSET_MS = 7 * 3600_000;

const wib = (ms: number) => new Date(ms + WIB_OFFSET_MS);
const pad = (n: number) => String(n).padStart(2, "0");

export const wibDay = (ms: number) => `${wib(ms).getUTCDate()} ${MONTHS[wib(ms).getUTCMonth()]}`;
export const wibTime = (ms: number) =>
  `${pad(wib(ms).getUTCHours())}:${pad(wib(ms).getUTCMinutes())}`;
export const wibStamp = (ms: number) =>
  `${wib(ms).getUTCFullYear()}-${pad(wib(ms).getUTCMonth() + 1)}-${pad(wib(ms).getUTCDate())} ${wibTime(ms)} WIB`;
export const isWibMonday = (ms: number) => wib(ms).getUTCDay() === 1;
export const wibDate = (ms: number) => wibStamp(ms).slice(0, 10);

export const STALE_AFTER_MS = 3600_000;
export const ago = (ms: number) => {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
};
