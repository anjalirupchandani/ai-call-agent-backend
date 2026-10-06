// lib/sms.js
// Sends the "install our app" SMS through gosms.in
//   POST https://gosms.in/api/v1/sms
// Server-side only — the API key never reaches the browser.
//
// Required .env:   GOSMS_API_KEY, SMS_INSTALL_LINK
// Optional .env:   GOSMS_API_URL, GOSMS_AUTH_HEADER, GOSMS_AUTH_SCHEME, GOSMS_SENDER_ID,
//                  GOSMS_ROUTE (sms | otp | dlt), GOSMS_DLT_TEMPLATE_ID, GOSMS_DLT_ENTITY_ID,
//                  GOSMS_DOMAIN, SMS_MESSAGE

const API_URL = () => process.env.GOSMS_API_URL || "https://gosms.in/api/v1/sms";

export function isSmsConfigured() {
  return Boolean(process.env.GOSMS_API_KEY && process.env.SMS_INSTALL_LINK);
}

// gosms.in wants a 10-digit Indian mobile number. Accepts "+919876543210",
// "919876543210", "09876543210" or "9876543210"; returns null for anything else.
export function toTenDigitIndianNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return null;
}

// {name} and {link} are replaced. With the DLT route the final text must match
// your approved template exactly, so set SMS_MESSAGE to that template's wording.
export function buildInstallMessage(name) {
  const template =
    process.env.SMS_MESSAGE || "Thanks for speaking with us! Install our app here: {link}";
  const firstName = String(name || "").trim().split(/\s+/)[0];
  return template
    .replaceAll("{name}", firstName && firstName !== "Unknown" ? firstName : "there")
    .replaceAll("{link}", process.env.SMS_INSTALL_LINK);
}

export async function sendInstallLinkSms(phone, name) {
  const to = toTenDigitIndianNumber(phone);
  if (!to) throw new Error(`"${phone}" is not a 10-digit Indian mobile number — SMS skipped.`);

  const payload = { to, message: buildInstallMessage(name) };
  if (process.env.GOSMS_SENDER_ID) payload.sender_id = process.env.GOSMS_SENDER_ID;
  if (process.env.GOSMS_ROUTE) payload.route = process.env.GOSMS_ROUTE;
  if (process.env.GOSMS_DLT_TEMPLATE_ID) payload.dlt_template_id = process.env.GOSMS_DLT_TEMPLATE_ID;
  if (process.env.GOSMS_DLT_ENTITY_ID) payload.dlt_entity_id = process.env.GOSMS_DLT_ENTITY_ID;
  if (process.env.GOSMS_DOMAIN) payload.domain = process.env.GOSMS_DOMAIN;

  // How the API key is sent. Defaults to "Authorization: Bearer <key>" — change
  // GOSMS_AUTH_HEADER / GOSMS_AUTH_SCHEME (empty scheme = raw key) to match the
  // "Authentication" section of the gosms.in docs.
  const headerName = process.env.GOSMS_AUTH_HEADER || "Authorization";
  const scheme = process.env.GOSMS_AUTH_SCHEME ?? "Bearer";
  const headerValue = scheme ? `${scheme} ${process.env.GOSMS_API_KEY}` : process.env.GOSMS_API_KEY;

  const res = await fetch(API_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/json", [headerName]: headerValue },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  const raw = await res.text();
  let body = {};
  try { body = JSON.parse(raw); } catch { body = { raw: raw.slice(0, 300) }; }

  // Always show what gosms.in answered, so a "sent" log can be checked against it.
  console.log(`[sms] gosms.in replied HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);

  const status = String(body?.status ?? "").toLowerCase();
  const rejected =
    !res.ok ||
    body?.success === false ||
    body?.error === true ||
    ["error", "failed", "failure", "rejected"].includes(status);
  if (rejected) {
    const reason = typeof body?.error === "string" ? body.error : "";
    throw new Error(body?.message || reason || `gosms.in returned HTTP ${res.status}`);
  }
  return body;
}