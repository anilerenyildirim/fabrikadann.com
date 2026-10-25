import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string };

let transport: ReturnType<typeof nodemailer.createTransport> | undefined;

/** SMTP_URL tanımlı değilse e-posta konsola yazılır (geliştirme). */
export async function sendMail(mail: Mail): Promise<void> {
  const url = process.env.SMTP_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      // Canlıda içerik (sıfırlama bağlantısı, adres) loglara yazılmaz
      console.error(`[e-posta] SMTP_URL tanımlı değil; gönderilemedi: ${mail.subject}`);
      return;
    }
    if (process.env.NODE_ENV !== "test") {
      console.info(`\n[e-posta] Kime: ${mail.to}\nKonu: ${mail.subject}\n\n${mail.text}\n`);
    }
    return;
  }
  transport ??= nodemailer.createTransport(url);
  await transport.sendMail({ from: process.env.MAIL_FROM, ...mail });
}
