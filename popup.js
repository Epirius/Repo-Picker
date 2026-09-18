const CACHE_KEY = "repoCache";
const STATUS_KEY = "status";

const statusEl = document.getElementById("status");
const reindexEl = document.getElementById("reindex");
const settingsEl = document.getElementById("settings");

function say(text, kind = "", action = null) {
  statusEl.textContent = text;
  statusEl.className = kind;
  const href = httpsUrl(action?.url);
  if (!href) return;
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = action.label || "Fix this";
  statusEl.append(" ", link);
}

function describeCache(cache) {
  if (!cache?.repos?.length) return "Nothing indexed yet.";
  const when = new Date(cache.fetchedAt).toLocaleString();
  return `${cache.repos.length} repositories, indexed ${when}.`;
}

async function show() {
  const stored = await browser.storage.local.get([CACHE_KEY, STATUS_KEY]);
  const status = stored[STATUS_KEY] || {};
  if (status.error) {
    say(status.error, "error", { url: status.actionUrl, label: status.actionLabel });
    return;
  }
  const expiresAt = status.tokenExpiresAt;
  const note = expiringSoon(expiresAt) ? expiryNote(expiresAt) : "";
  const expired = Boolean(expiresAt) && expiresAt <= Date.now();
  say([describeCache(stored[CACHE_KEY]), note].filter(Boolean).join(" "), expired ? "error" : "");
}

reindexEl.addEventListener("click", async () => {
  reindexEl.disabled = true;
  say("Reindexing...");
  try {
    const result = await browser.runtime.sendMessage({ type: "refresh" });
    if (result.ok) {
      const when = new Date(result.fetchedAt).toLocaleString();
      say(`${result.count} repositories, indexed ${when}.`);
    } else {
      say(result.error, "error", { url: result.actionUrl, label: result.actionLabel });
    }
  } catch (err) {
    say(String(err.message || err), "error");
  } finally {
    reindexEl.disabled = false;
  }
});

settingsEl.addEventListener("click", async () => {
  await browser.runtime.openOptionsPage();
  window.close();
});

show();
