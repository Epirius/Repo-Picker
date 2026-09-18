const CONFIG_KEY = "config";
const CACHE_KEY = "repoCache";
const ORIGINS = { origins: ["https://api.github.com/*"] };

const orgsEl = document.getElementById("orgs");
const tokenEl = document.getElementById("token");
const personalEl = document.getElementById("personal");
const saveEl = document.getElementById("save");
const refreshEl = document.getElementById("refresh");
const statusEl = document.getElementById("status");

document.getElementById("keyword").textContent =
  browser.runtime.getManifest().omnibox.keyword;

function say(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function parseOrgs(text) {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function showCacheState() {
  const stored = await browser.storage.local.get(CACHE_KEY);
  const cache = stored[CACHE_KEY];
  if (!cache?.repos?.length) {
    say("Nothing cached yet.");
    return;
  }
  const when = new Date(cache.fetchedAt).toLocaleString();
  say(`${cache.repos.length} repositories cached, last fetched ${when}.`, "ok");
}

async function load() {
  const stored = await browser.storage.local.get(CONFIG_KEY);
  const config = stored[CONFIG_KEY] || {};
  orgsEl.value = (config.orgs || []).join("\n");
  tokenEl.value = config.token || "";
  personalEl.checked = Boolean(config.includePersonal);
  await showCacheState();
}

async function fetchNow() {
  saveEl.disabled = true;
  refreshEl.disabled = true;
  say("Fetching...");
  try {
    const result = await browser.runtime.sendMessage({ type: "refresh" });
    const when = new Date(result.fetchedAt).toLocaleString();
    say(`${result.count} repositories cached, last fetched ${when}.`, "ok");
  } catch (err) {
    say(String(err.message || err), "error");
  } finally {
    saveEl.disabled = false;
    refreshEl.disabled = false;
  }
}

saveEl.addEventListener("click", async () => {
  const config = {
    orgs: parseOrgs(orgsEl.value),
    token: tokenEl.value.trim(),
    includePersonal: personalEl.checked
  };

  if (!(await browser.permissions.contains(ORIGINS))) {
    const granted = await browser.permissions.request(ORIGINS);
    if (!granted) {
      say("Access to api.github.com was declined, so nothing can be fetched.", "error");
      return;
    }
  }

  await browser.storage.local.set({ [CONFIG_KEY]: config });
  orgsEl.value = config.orgs.join("\n");
  await fetchNow();
});

refreshEl.addEventListener("click", fetchNow);

load();
