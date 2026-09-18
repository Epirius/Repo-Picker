const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_MS = 14 * DAY_MS;

function parseExpiry(value) {
  if (!value) return 0;
  const iso = value
    .trim()
    .replace(" ", "T")
    .replace(" UTC", "Z")
    .replace(/\s*([+-]\d{2}):?(\d{2})$/, "$1:$2");
  return Date.parse(iso) || Date.parse(value) || 0;
}

function expiringSoon(expiresAt, now = Date.now()) {
  return Boolean(expiresAt) && expiresAt - now <= EXPIRY_WARNING_MS;
}

function expiryNote(expiresAt, now = Date.now()) {
  if (!expiresAt) return "";
  const when = new Date(expiresAt).toLocaleDateString();
  if (expiresAt <= now) return `The token expired on ${when}. Create a new one and paste it in.`;
  const days = Math.ceil((expiresAt - now) / DAY_MS);
  if (expiringSoon(expiresAt, now)) {
    return `The token expires in ${days} ${days === 1 ? "day" : "days"}, on ${when}.`;
  }
  return `The token expires on ${when}.`;
}
