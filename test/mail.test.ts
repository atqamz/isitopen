import { describe, expect, it, vi } from "vitest";
import { render, sendMail } from "../src/mail";

const env = { EMAIL_FROM: "alert@example.com", EMAIL_TO: "me@example.org" };
const mail = {
  subject: "SE Career is OPEN",
  body: "Registration is open.\nCourse: https://x.test\n",
};

describe("render", () => {
  it("builds a plain-text MIME message", () => {
    const raw = render(env, mail, new Date("2026-11-10T06:00:00Z"));
    const [head, body] = raw.split("\r\n\r\n");
    expect(head).toContain("From: isitopen <alert@example.com>");
    expect(head).toContain("To: me@example.org");
    expect(head).toContain("Subject: SE Career is OPEN");
    expect(head).toContain("Date: Tue, 10 Nov 2026 06:00:00 GMT");
    expect(head).toMatch(/Message-ID: <[\w-]+@example\.com>/);
    expect(head).toContain("MIME-Version: 1.0");
    expect(head).toContain("Content-Type: text/plain; charset=utf-8");
    expect(atob(body.replaceAll("\r\n", ""))).toBe(mail.body);
  });

  it("wraps base64 lines at 76 characters and keeps UTF-8", () => {
    const long = { subject: "s", body: `${"é".repeat(200)}\n` };
    const body = render(env, long, new Date()).split("\r\n\r\n")[1];
    for (const line of body.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    const bytes = Uint8Array.from(atob(body.replaceAll("\r\n", "")), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(long.body);
  });
});

describe("sendMail", () => {
  it("sends through the binding from EMAIL_FROM to EMAIL_TO", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await sendMail({ ...env, MAIL: { send } }, mail)).toBe(true);
    const message = send.mock.calls[0][0];
    expect(message.from).toBe(env.EMAIL_FROM);
    expect(message.to).toBe(env.EMAIL_TO);
  });

  it("returns false and logs without the body when the send fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn().mockRejectedValue(new Error("destination address not verified"));
    expect(await sendMail({ ...env, MAIL: { send } }, mail)).toBe(false);
    expect(log).toHaveBeenCalledWith("mail send failed", "SE Career is OPEN", "Error");
    log.mockRestore();
  });
});
