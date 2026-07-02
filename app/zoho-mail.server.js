import nodemailer from "nodemailer";

const ZOHO_SMTP_HOST = String(process.env.ZOHO_SMTP_HOST || "smtp.zoho.com").trim();
const ZOHO_SMTP_PORT = Number(process.env.ZOHO_SMTP_PORT || 587);
const ZOHO_SMTP_USER = String(process.env.ZOHO_SMTP_USER || "").trim();
const ZOHO_SMTP_PASSWORD = String(process.env.ZOHO_SMTP_PASSWORD || "").trim();
const ZOHO_ZEPTOMAIL_TOKEN = String(
  process.env.ZOHO_ZEPTOMAIL_TOKEN || process.env.ZEPTOMAIL_API_KEY || "",
).trim();
const ZOHO_MAIL_FROM = String(process.env.ZOHO_MAIL_FROM || ZOHO_SMTP_USER).trim();
const ZOHO_MAIL_FROM_NAME = String(process.env.ZOHO_MAIL_FROM_NAME || "Omafit").trim();
const SMTP_SEND_TIMEOUT_MS = Number(process.env.ZOHO_SMTP_TIMEOUT_MS || 12_000);

let transporterPromise = null;

function isRailwayHosting() {
  return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID);
}

function hasZeptoMailToken() {
  return Boolean(ZOHO_ZEPTOMAIL_TOKEN);
}

function hasSmtpCredentials() {
  return Boolean(ZOHO_SMTP_USER && ZOHO_SMTP_PASSWORD);
}

export function isZohoMailConfigured() {
  return hasZeptoMailToken() || hasSmtpCredentials();
}

/** @returns {"zeptomail" | "smtp" | "unconfigured"} */
export function getZohoMailDeliveryMode() {
  if (hasZeptoMailToken()) return "zeptomail";
  if (hasSmtpCredentials()) return "smtp";
  return "unconfigured";
}

function resolveFromAddress() {
  const from = ZOHO_MAIL_FROM || ZOHO_SMTP_USER;
  if (!from) {
    throw new Error("zoho_from_missing");
  }
  return from;
}

function withTimeout(promise, ms, errorCode) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(errorCode)), ms);
    }),
  ]);
}

async function sendZohoMailViaZeptoMail({ to, subject, text, html, replyTo }) {
  if (!hasZeptoMailToken()) {
    throw new Error("zoho_zeptomail_not_configured");
  }

  const from = resolveFromAddress();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch("https://api.zeptomail.com/v1.1/email", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Zoho-enczapikey ${ZOHO_ZEPTOMAIL_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: { address: from, name: ZOHO_MAIL_FROM_NAME },
        to: [{ email_address: { address: to } }],
        subject,
        htmlbody: html || undefined,
        textbody: text || undefined,
        reply_to: replyTo ? [{ address: replyTo, name: ZOHO_MAIL_FROM_NAME }] : undefined,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail =
        payload?.error?.message ||
        payload?.message ||
        payload?.data?.[0]?.message ||
        `HTTP ${response.status}`;
      throw new Error(`zeptomail_send_failed: ${detail}`);
    }

    const requestId =
      payload?.request_id ||
      payload?.data?.[0]?.message_id ||
      payload?.data?.[0]?.code ||
      "queued";

    return { messageId: String(requestId), transport: "zeptomail" };
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("zeptomail_timeout");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function getSmtpTransporter() {
  if (!hasSmtpCredentials()) {
    throw new Error("zoho_not_configured");
  }
  if (!transporterPromise) {
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: ZOHO_SMTP_HOST,
        port: ZOHO_SMTP_PORT,
        secure: ZOHO_SMTP_PORT === 465,
        requireTLS: ZOHO_SMTP_PORT === 587,
        auth: {
          user: ZOHO_SMTP_USER,
          pass: ZOHO_SMTP_PASSWORD,
        },
        connectionTimeout: SMTP_SEND_TIMEOUT_MS,
        greetingTimeout: SMTP_SEND_TIMEOUT_MS,
        socketTimeout: SMTP_SEND_TIMEOUT_MS,
      }),
    );
  }
  return transporterPromise;
}

async function sendZohoMailViaSmtp({ to, subject, text, html, replyTo }) {
  if (isRailwayHosting() && !hasZeptoMailToken()) {
    throw new Error("railway_smtp_blocked");
  }

  const transporter = await getSmtpTransporter();
  const from = resolveFromAddress();

  const info = await withTimeout(
    transporter.sendMail({
      from: `"${ZOHO_MAIL_FROM_NAME}" <${from}>`,
      to,
      subject,
      text,
      html,
      replyTo: replyTo || from,
    }),
    SMTP_SEND_TIMEOUT_MS,
    "smtp_timeout",
  );

  return { messageId: info.messageId, transport: "smtp" };
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string, replyTo?: string }} params
 */
export async function sendZohoMail(params) {
  if (hasZeptoMailToken()) {
    return sendZohoMailViaZeptoMail(params);
  }
  return sendZohoMailViaSmtp(params);
}
