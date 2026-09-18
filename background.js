const API = "https://api.github.com";
const CONFIG_KEY = "config";
const CACHE_KEY = "repoCache";
const STATUS_KEY = "status";
const REFRESH_ALARM = "refresh-repos";
const STALE_MS = 6 * 60 * 60 * 1000;
const MAX_SUGGESTIONS = 8;

let memo = null;
let inFlight = null;
let inputSeq = 0;

async function getConfig() {
  const stored = await browser.storage.local.get(CONFIG_KEY);
  return {
    orgs: [],
    token: "",
    includePersonal: false,
    ...(stored[CONFIG_KEY] || {})
  };
}

async function getCache() {
  if (memo) return memo;
  const stored = await browser.storage.local.get(CACHE_KEY);
  memo = stored[CACHE_KEY] || { repos: [], fetchedAt: 0 };
  return memo;
}

async function setStatus(fields) {
  const stored = await browser.storage.local.get(STATUS_KEY);
  await browser.storage.local.set({
    [STATUS_KEY]: { ...(stored[STATUS_KEY] || {}), ...fields }
  });
}

function nextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

async function fetchPaged(url, token) {
  const out = [];
  let next = url;
  while (next) {
    const res = await fetch(next, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub returned ${res.status}: ${body.slice(0, 200)}`);
    }
    out.push(...(await res.json()));
    next = nextPageUrl(res.headers.get("Link"));
  }
  return out;
}

async function refreshRepos() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const { orgs, token, includePersonal } = await getConfig();
    if (!token) throw new Error("No access token set. Open the extension options.");
    if (!orgs.length && !includePersonal) {
      throw new Error("No organizations set. Open the extension options.");
    }

    const urls = orgs.map(
      (org) =>
        `${API}/orgs/${encodeURIComponent(org)}/repos?per_page=100&type=all&sort=pushed`
    );
    if (includePersonal) {
      urls.push(`${API}/user/repos?per_page=100&affiliation=owner,collaborator&sort=pushed`);
    }

    const pages = await Promise.all(urls.map((u) => fetchPaged(u, token)));

    const byFullName = new Map();
    for (const repo of pages.flat()) {
      byFullName.set(repo.full_name, {
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        description: repo.description || "",
        archived: Boolean(repo.archived),
        pushedAt: Date.parse(repo.pushed_at) || 0
      });
    }

    const repos = [...byFullName.values()].sort((a, b) => b.pushedAt - a.pushedAt);
    memo = { repos, fetchedAt: Date.now() };
    await browser.storage.local.set({ [CACHE_KEY]: memo });
    await setStatus({ count: repos.length, fetchedAt: memo.fetchedAt, error: null });
    return memo;
  })();

  try {
    return await inFlight;
  } catch (err) {
    await setStatus({ error: String(err.message || err) });
    throw err;
  } finally {
    inFlight = null;
  }
}

async function refreshIfStale() {
  const cache = await getCache();
  if (Date.now() - cache.fetchedAt < STALE_MS && cache.repos.length) return;
  try {
    await refreshRepos();
  } catch {
    // surfaced through the status record and the omnibox default suggestion
  }
}

function subsequenceScore(text, query) {
  let cursor = 0;
  let gaps = 0;
  let run = 0;
  let bonus = 0;
  for (const ch of query) {
    const at = text.indexOf(ch, cursor);
    if (at === -1) return null;
    if (at === cursor && cursor > 0) {
      run += 1;
      bonus += run * 2;
    } else {
      run = 0;
      gaps += at - cursor;
    }
    if (at === 0 || "-_./".includes(text[at - 1])) bonus += 6;
    cursor = at + 1;
  }
  return bonus - gaps;
}

function score(repo, query) {
  const name = repo.name.toLowerCase();
  const full = repo.fullName.toLowerCase();
  let value;

  if (name === query) value = 10000;
  else if (name.startsWith(query)) value = 8000 - name.length;
  else if (full.startsWith(query)) value = 7000 - full.length;
  else if (name.includes(query)) value = 6000 - name.indexOf(query) * 10;
  else if (full.includes(query)) value = 5000 - full.indexOf(query) * 10;
  else {
    const fuzzy = subsequenceScore(name, query) ?? subsequenceScore(full, query);
    if (fuzzy === null) return null;
    value = 2000 + fuzzy;
  }

  if (repo.archived) value -= 4000;
  return value;
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function describe(repo) {
  const suffix = repo.archived ? " (archived)" : "";
  const tail = repo.description ? ` ${repo.description.slice(0, 90)}` : "";
  return `<match>${escapeXml(repo.fullName + suffix)}</match><dim>${escapeXml(tail)}</dim>`;
}

function searchUrl(query, orgs) {
  const scope = orgs.length ? orgs.map((o) => `org:${o}`).join(" ") + " " : "";
  return `https://github.com/search?type=repositories&q=${encodeURIComponent(scope + query)}`;
}

browser.omnibox.setDefaultSuggestion({
  description: "Start typing a repository name"
});

browser.omnibox.onInputStarted.addListener(() => {
  refreshIfStale();
});

browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const seq = ++inputSeq;
  const query = text.trim().toLowerCase();
  const [cache, config, stored] = await Promise.all([
    getCache(),
    getConfig(),
    browser.storage.local.get(STATUS_KEY)
  ]);
  if (seq !== inputSeq) return;

  const status = stored[STATUS_KEY] || {};

  if (status.error && !cache.repos.length) {
    browser.omnibox.setDefaultSuggestion({
      description: escapeXml(status.error)
    });
    suggest([]);
    return;
  }

  if (!query) {
    browser.omnibox.setDefaultSuggestion({
      description: `Start typing a repository name (${cache.repos.length} cached)`
    });
    suggest([]);
    return;
  }

  browser.omnibox.setDefaultSuggestion({
    description: `Search GitHub for <match>${escapeXml(text)}</match>`
  });

  const scored = [];
  for (const repo of cache.repos) {
    const value = score(repo, query);
    if (value !== null) scored.push({ repo, value });
  }
  scored.sort((a, b) => b.value - a.value || b.repo.pushedAt - a.repo.pushedAt);

  const results = scored
    .slice(0, MAX_SUGGESTIONS)
    .map(({ repo }) => ({ content: repo.url, description: describe(repo) }));

  if (query.includes("/") && !results.length) {
    results.push({
      content: `https://github.com/${text.trim()}`,
      description: `Open <match>github.com/${escapeXml(text.trim())}</match>`
    });
  }

  if (seq === inputSeq) suggest(results);
});

browser.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const trimmed = text.trim();
  let url;
  if (trimmed.startsWith("https://")) {
    url = trimmed;
  } else {
    const { orgs } = await getConfig();
    url = searchUrl(trimmed, orgs);
  }

  if (disposition === "newForegroundTab") await browser.tabs.create({ url });
  else if (disposition === "newBackgroundTab") await browser.tabs.create({ url, active: false });
  else await browser.tabs.update({ url });
});

browser.alarms.create(REFRESH_ALARM, { periodInMinutes: 360 });

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) refreshIfStale();
});

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type !== "refresh") return;
  const cache = await refreshRepos();
  return { count: cache.repos.length, fetchedAt: cache.fetchedAt };
});
