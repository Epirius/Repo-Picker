const CONFIG_KEY = "config";
const CACHE_KEY = "repoCache";
const ORIGINS = { origins: ["https://api.github.com/*"] };
const CAPTURE = { origins: ["https://github.com/settings/*"] };

const orgsEl = document.getElementById("orgs");
const tokenEl = document.getElementById("token");
const personalEl = document.getElementById("personal");
const captureEl = document.getElementById("capture");
const saveEl = document.getElementById("save");
const refreshEl = document.getElementById("refresh");
const statusEl = document.getElementById("status");

let persistTimer = null;

document.getElementById("keyword").textContent =
  browser.runtime.getManifest().omnibox.keyword;

function say(text, kind = "", action = null) {
  statusEl.textContent = text;
  statusEl.className = kind;
  if (!action?.url) return;
  const link = document.createElement("a");
  link.href = action.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = action.label || "Fix this";
  statusEl.append(" ", link);
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
  captureEl.checked = await browser.permissions.contains(CAPTURE);
  await showCacheState();
}

captureEl.addEventListener("change", async () => {
  if (captureEl.checked) {
    captureEl.checked = await browser.permissions.request(CAPTURE);
    if (!captureEl.checked) say("Access to the GitHub settings page was declined.", "error");
  } else {
    await browser.permissions.remove(CAPTURE);
  }
});

async function fetchNow() {
  saveEl.disabled = true;
  refreshEl.disabled = true;
  say("Fetching...");
  try {
    const result = await browser.runtime.sendMessage({ type: "refresh" });
    if (result.ok) {
      const when = new Date(result.fetchedAt).toLocaleString();
      say(`${result.count} repositories cached, last fetched ${when}.`, "ok");
    } else {
      say(result.error, "error", { url: result.actionUrl, label: result.actionLabel });
    }
  } catch (err) {
    say(String(err.message || err), "error");
  } finally {
    saveEl.disabled = false;
    refreshEl.disabled = false;
  }
}

async function persist() {
  clearTimeout(persistTimer);
  const stored = await browser.storage.local.get(CONFIG_KEY);
  await browser.storage.local.set({
    [CONFIG_KEY]: {
      ...(stored[CONFIG_KEY] || {}),
      orgs: parseOrgs(orgsEl.value),
      token: tokenEl.value.trim(),
      includePersonal: personalEl.checked
    }
  });
}

function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 300);
}

orgsEl.addEventListener("input", persistSoon);
tokenEl.addEventListener("input", persistSoon);
personalEl.addEventListener("change", persistSoon);

saveEl.addEventListener("click", async () => {
  await persist();

  if (!(await browser.permissions.contains(ORIGINS))) {
    const granted = await browser.permissions.request(ORIGINS);
    if (!granted) {
      say("Access to api.github.com was declined, so nothing can be fetched.", "error");
      return;
    }
  }

  orgsEl.value = parseOrgs(orgsEl.value).join("\n");
  await fetchNow();
});

refreshEl.addEventListener("click", fetchNow);

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const nextToken = changes[CONFIG_KEY]?.newValue?.token;
  if (nextToken !== undefined && nextToken !== tokenEl.value && document.activeElement !== tokenEl) {
    tokenEl.value = nextToken || "";
  }
  if (changes[CACHE_KEY]) showCacheState();
});

load();
