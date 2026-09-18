const ORG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_URL_RE = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i;

function orgFromEntry(entry) {
  let text = entry.trim().replace(/^@/, "");
  if (!text) return null;

  const url = text.match(GITHUB_URL_RE);
  if (url) {
    const parts = url[1].split(/[?#]/)[0].split("/").filter(Boolean);
    text = parts[0] === "orgs" || parts[0] === "users" ? parts[1] || "" : parts[0] || "";
  }

  return ORG_RE.test(text) ? text : null;
}

function parseOrgs(text) {
  const seen = new Map();
  for (const entry of text.split(/[\s,]+/)) {
    const org = orgFromEntry(entry);
    if (org && !seen.has(org.toLowerCase())) seen.set(org.toLowerCase(), org);
  }
  return [...seen.values()];
}

function countEntries(text) {
  return text.split(/[\s,]+/).filter((entry) => entry.trim()).length;
}
