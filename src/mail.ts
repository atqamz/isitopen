import { EmailMessage } from "cloudflare:email";
import type { Mail } from "./step";

export interface MailEnv {
  MAIL: SendEmail;
  EMAIL_FROM: string;
  EMAIL_TO: string;
}

function base64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/.{76}/g, "$&\r\n");
}

export function render(
  env: Pick<MailEnv, "EMAIL_FROM" | "EMAIL_TO">,
  mail: Mail,
  now: Date,
): string {
  return [
    `From: isitopen <${env.EMAIL_FROM}>`,
    `To: ${env.EMAIL_TO}`,
    `Subject: ${mail.subject}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${env.EMAIL_FROM.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64(mail.body),
  ].join("\r\n");
}

export async function sendMail(env: MailEnv, mail: Mail): Promise<boolean> {
  try {
    await env.MAIL.send(
      new EmailMessage(env.EMAIL_FROM, env.EMAIL_TO, render(env, mail, new Date())),
    );
    return true;
  } catch (e) {
    console.error("mail send failed", mail.subject, e instanceof Error ? e.name : "unknown");
    return false;
  }
}
