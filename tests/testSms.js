// Sends one test SMS without making a call.
// Usage (from the ai-call-agent-backend folder):  node scripts/test-sms.js 9925715787
import "dotenv/config";
import { isSmsConfigured, sendInstallLinkSms } from "../lib/sms.js";

const phone = process.argv[2];
if (!phone) {
  console.error("Usage: node scripts/test-sms.js <10-digit mobile number>");
  process.exit(1);
}
if (!isSmsConfigured()) {
  console.error("Set GOSMS_API_KEY and SMS_INSTALL_LINK in .env first.");
  process.exit(1);
}

try {
  await sendInstallLinkSms(phone, "Test");
  console.log("Request accepted — check the reply above and your phone.");
} catch (err) {
  console.error("SMS failed:", err.message);
  process.exit(1);
}