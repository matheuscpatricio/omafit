import nodemailer from "nodemailer";

const ZOHO_SMTP_HOST = String(process.env.ZOHO_SMTP_HOST || "smtp.zoho.com").trim();
const ZOHO_SMTP_PORT = Number(process.env.ZOHO_SMTP_PORT || 465);
const ZOHO_SMTP_USER = String(process.env.ZOHO_SMTP_USER || "").trim();
const ZOHO_SMTP_PASSWORD = String(process.env.ZOHO_SMTP_PASSWORD || "").trim();
const ZOHO_MAIL_FROM = String(process.env.ZOHO_MAIL_FROM || ZOHO_SMTP_USER).trim();
const ZOHO_MAIL_FROM_NAME = String(process.env.ZOHO_MAIL_FROM_NAME || "Omafit").trim();

let transporterPromise = null;

export function isZohoMailConfigured() {
  return Boolean(ZOHO_SMTP_USER && ZOHO_SMTP_PASSWORD);
}

function getTransporter() {
  if (!isZohoMailConfigured()) {
    throw new Error("zoho_not_configured");
  }
  if (!transporterPromise) {
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: ZOHO_SMTP_HOST,
        port: ZOHO_SMTP_PORT,
        secure: ZOHO_SMTP_PORT === 465,
        auth: {
          user: ZOHO_SMTP_USER,
          pass: ZOHO_SMTP_PASSWORD,
        },
      }),
    );
  }
  return transporterPromise;
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string, replyTo?: string }} params
 */
export async function sendZohoMail({ to, subject, text, html, replyTo }) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: `"${ZOHO_MAIL_FROM_NAME}" <${ZOHO_MAIL_FROM}>`,
    to,
    subject,
    text,
    html,
    replyTo: replyTo || ZOHO_SMTP_USER,
  });
  return { messageId: info.messageId };
}
