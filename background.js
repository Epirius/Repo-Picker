const API = "https://api.github.com";
const CONFIG_KEY = "config";
const CACHE_KEY = "repoCache";
const STATUS_KEY = "status";
const REFRESH_ALARM = "refresh-repos";
const STALE_MS = 6 * 60 * 60 * 1000;
const MAX_SUGGESTIONS = 8;
const CAPTURE_ORIGIN = "https://github.com/settings/*";
const CAPTURE_ID = "token-capture";
const OWNER_MIN_PX = 800;
const DESCRIPTION_MIN_PX = 1200;
const SEPARATOR = " · ";
const PAGE_PREFIX = `${API}/`;
const PATH_RE = /^[^\s/]+\/[^\s/]+$/;

let memo = null;
let inFlight = null;
let inputSeq = 0;
let windowWidth = null;
let links = new Map();

async function getConfig() {
  const stored = await browser.storage.local.get(CONFIG_KEY);
  return {
    orgs: [],
    token: "",
    includePersonal: false,
    includeStarred: false,
    includeFollowing: false,
    ...(stored[CONFIG_KEY] || {})
  };
}

async function getCache() {
  if (memo) return memo;
  const stored = await browser.storage.local.get(CACHE_KEY);
  memo = stored[CACHE_KEY] || { repos: [], fetchedAt: 0, kinds: {} };
  return memo;
}

async function setStatus(fields) {
  const stored = await browser.storage.local.get(STATUS_KEY);
  await browser.storage.local.set({
    [STATUS_KEY]: { ...(stored[STATUS_KEY] || {}), ...fields }
  });
}

function onApiHost(url) {
  // fetch() strips whitespace and rewrites backslashes before parsing, so a URL
  // carrying either can pass a prefix test and still resolve to another host.
  if (/[\s\\]/.test(url)) return false;
  return url.slice(0, PAGE_PREFIX.length).toLowerCase() === PAGE_PREFIX;
}

function nextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const url = part.match(/<([^>]+)>\s*;\s*rel="next"/)?.[1];
    if (!url) continue;
    if (!onApiHost(url)) {
      throw new GitHubError(`Refusing to send the token to ${url}, which is not api.github.com.`);
    }
    return url;
  }
  return null;
}

class GitHubError extends Error {
  constructor(message, actionUrl, actionLabel) {
    super(message);
    this.actionUrl = httpsUrl(actionUrl);
    this.actionLabel = actionLabel || null;
    this.status = 0;
  }
}

function configError(message) {
  const err = new GitHubError(message);
  err.actionLabel = "Open options";
  err.actionMessage = "openOptions";
  return err;
}

function orgFromUrl(url) {
  return decodeURIComponent(url.match(/\/(?:orgs|users)\/([^/?]+)/)?.[1] || "");
}

async function githubError(res, url) {
  const err = await describeFailure(res, url);
  err.status = res.status;
  return err;
}

async function describeFailure(res, url) {
  const body = await res.text();
  let message = body.slice(0, 200);
  try {
    message = JSON.parse(body).message || message;
  } catch {
    // a non-JSON body is rare, but the raw text is still the best clue
  }

  const org = orgFromUrl(url);

  if (res.status === 403 && /SAML/i.test(message)) {
    const sso = res.headers.get("X-GitHub-SSO") || "";
    const link = httpsUrl(sso.match(/url=(\S+)/)?.[1]);
    return new GitHubError(
      `${org || "This organization"} uses SAML single sign-on, and this token is not authorized for it yet.`,
      link || (org ? `https://github.com/orgs/${org}/sso` : "https://github.com/settings/tokens"),
      "Authorize the token"
    );
  }

  if (res.status === 401) {
    return new GitHubError(
      "GitHub rejected the token. It may be mistyped, revoked or expired.",
      "https://github.com/settings/tokens",
      "Manage tokens"
    );
  }

  if (res.status === 403 && /rate limit/i.test(message)) {
    return new GitHubError("GitHub rate limit reached. Try again in a few minutes.");
  }

  if (res.status === 404 && org) {
    return new GitHubError(
      `No organization or user named ${org}, or this token cannot see it. Check the spelling against the URL on GitHub.`
    );
  }

  return new GitHubError(`GitHub returned ${res.status}: ${message}`);
}

async function fetchPaged(url, token) {
  const out = [];
  let next = url;
  while (next) {
    let res;
    try {
      res = await fetch(next, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28"
        }
      });
    } catch {
      throw configError(
        "Could not reach api.github.com. Open the options page and click Save and fetch to grant access."
      );
    }
    if (!res.ok) throw await githubError(res, next);
    out.push(...(await res.json()));
    next = nextPageUrl(res.headers.get("Link"));
  }
  return out;
}

async function mapLimit(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
}

async function followedRepos(token) {
  const following = await fetchPaged(`${API}/user/following?per_page=100`, token);
  const out = [];
  await mapLimit(following, 6, async (user) => {
    try {
      const repos = await fetchPaged(
        `${API}/users/${encodeURIComponent(user.login)}/repos?per_page=100&type=owner&sort=pushed`,
        token
      );
      out.push(...repos);
    } catch {
      // a followed account can be deleted or made private between the two calls
    }
  });
  return out;
}

async function ownerRepos(name, token) {
  const encoded = encodeURIComponent(name);
  try {
    return {
      name,
      kind: "org",
      repos: await fetchPaged(`${API}/orgs/${encoded}/repos?per_page=100&type=all&sort=pushed`, token)
    };
  } catch (err) {
    if (err.status !== 404) throw err;
    return {
      name,
      kind: "user",
      repos: await fetchPaged(`${API}/users/${encoded}/repos?per_page=100&type=owner&sort=pushed`, token)
    };
  }
}

async function refreshRepos() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const { orgs, token, includePersonal, includeStarred, includeFollowing } = await getConfig();
    if (!token) throw configError("No access token saved yet.");
    if (!orgs.length && !includePersonal && !includeStarred && !includeFollowing) {
      throw configError(
        "No organization saved yet. Add one in the options page, then click Save and fetch."
      );
    }

    const owners = await Promise.all(orgs.map((name) => ownerRepos(name, token)));
    const kinds = {};
    const found = [];
    for (const owner of owners) {
      kinds[owner.name.toLowerCase()] = owner.kind;
      found.push(...owner.repos);
    }

    const urls = [];
    if (includePersonal) {
      urls.push(`${API}/user/repos?per_page=100&affiliation=owner,collaborator&sort=pushed`);
    }
    if (includeStarred) {
      urls.push(`${API}/user/starred?per_page=100`);
    }

    const pages = await Promise.all(urls.map((u) => fetchPaged(u, token)));
    found.push(...pages.flat());
    if (includeFollowing) found.push(...(await followedRepos(token)));

    const byFullName = new Map();
    for (const repo of found) {
      byFullName.set(repo.full_name, {
        name: repo.name,
        owner: repo.owner?.login || repo.full_name.split("/")[0],
        fullName: repo.full_name,
        url: repo.html_url,
        description: repo.description || "",
        archived: Boolean(repo.archived),
        pushedAt: Date.parse(repo.pushed_at) || 0
      });
    }

    const repos = [...byFullName.values()].sort((a, b) => b.pushedAt - a.pushedAt);
    memo = { repos, fetchedAt: Date.now(), kinds };
    await browser.storage.local.set({ [CACHE_KEY]: memo });
    await setStatus({
      count: repos.length,
      fetchedAt: memo.fetchedAt,
      error: null,
      actionUrl: null,
      actionLabel: null,
      actionMessage: null
    });
    return memo;
  })();

  try {
    return await inFlight;
  } catch (err) {
    await setStatus({
      error: String(err.message || err),
      actionUrl: err.actionUrl || null,
      actionLabel: err.actionLabel || null,
      actionMessage: err.actionMessage || null
    });
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

async function measureWindow() {
  try {
    const win = await browser.windows.getCurrent();
    if (win?.width) windowWidth = win.width;
  } catch {
    windowWidth = null;
  }
}

function clip(text, limit) {
  const tidy = text.replace(/\s+/g, " ").trim();
  return tidy.length > limit ? `${tidy.slice(0, limit - 1)}…` : tidy;
}

function describe(repo) {
  const width = windowWidth ?? DESCRIPTION_MIN_PX;
  const parts = [repo.archived ? `${repo.name} (archived)` : repo.name];

  if (width >= OWNER_MIN_PX) {
    parts.push(repo.owner || repo.fullName.split("/")[0]);
  }
  if (width >= DESCRIPTION_MIN_PX && repo.description) {
    parts.push(clip(repo.description, 80));
  }
  return parts.join(SEPARATOR);
}

function resolveLink(text) {
  if (links.has(text)) return links.get(text);
  if (text.startsWith("https://")) return text;
  if (PATH_RE.test(text)) return `https://github.com/${text}`;
  return null;
}

function searchUrl(query, orgs, kinds = {}) {
  const scope = orgs.length
    ? orgs.map((o) => `${kinds[o.toLowerCase()] === "user" ? "user" : "org"}:${o}`).join(" ") + " "
    : "";
  return `https://github.com/search?type=repositories&q=${encodeURIComponent(scope + query)}`;
}

browser.omnibox.setDefaultSuggestion({
  description: "Start typing a repository name"
});

browser.omnibox.onInputStarted.addListener(() => {
  measureWindow();
  refreshIfStale();
});

browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const seq = ++inputSeq;
  const query = text.trim().toLowerCase();
  const [cache, stored] = await Promise.all([
    getCache(),
    browser.storage.local.get(STATUS_KEY),
    windowWidth === null ? measureWindow() : null
  ]);
  if (seq !== inputSeq) return;

  const status = stored[STATUS_KEY] || {};

  if (status.error && !cache.repos.length) {
    browser.omnibox.setDefaultSuggestion({
      description: status.error
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

  const typed = text.trim();
  browser.omnibox.setDefaultSuggestion({
    description: PATH_RE.test(typed) ? `Open github.com/${typed}` : `Search GitHub for ${typed}`
  });

  const scored = [];
  for (const repo of cache.repos) {
    const value = score(repo, query);
    if (value !== null) scored.push({ repo, value });
  }
  scored.sort((a, b) => b.value - a.value || b.repo.pushedAt - a.repo.pushedAt);

  const top = scored.slice(0, MAX_SUGGESTIONS).map(({ repo }) => repo);
  const nameCount = new Map();
  for (const repo of top) nameCount.set(repo.name, (nameCount.get(repo.name) || 0) + 1);

  links = new Map();
  const results = top.map((repo) => {
    const content = nameCount.get(repo.name) === 1 ? repo.name : repo.fullName;
    links.set(content, repo.url);
    return { content, description: describe(repo) };
  });

  if (seq === inputSeq) suggest(results);
});

browser.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const trimmed = text.trim();
  let url = resolveLink(trimmed);
  if (!url) {
    const [{ orgs }, cache] = await Promise.all([getConfig(), getCache()]);
    url = searchUrl(trimmed, orgs, cache.kinds || {});
  }

  if (disposition === "newForegroundTab") await browser.tabs.create({ url });
  else if (disposition === "newBackgroundTab") await browser.tabs.create({ url, active: false });
  else await browser.tabs.update({ url });
});

browser.alarms.create(REFRESH_ALARM, { periodInMinutes: 360 });

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) refreshIfStale();
});

async function fetchResult() {
  try {
    const cache = await refreshRepos();
    return { ok: true, count: cache.repos.length, fetchedAt: cache.fetchedAt };
  } catch (err) {
    return {
      ok: false,
      error: String(err.message || err),
      actionUrl: err.actionUrl || null,
      actionLabel: err.actionLabel || null,
      actionMessage: err.actionMessage || null
    };
  }
}

const CAPTURE_SCRIPT = {
  id: CAPTURE_ID,
  matches: [CAPTURE_ORIGIN],
  js: ["https-url.js", "capture.js"],
  runAt: "document_idle",
  persistAcrossSessions: true
};

async function syncCapture() {
  const granted = await browser.permissions.contains({ origins: [CAPTURE_ORIGIN] });
  const [registered] = await browser.scripting.getRegisteredContentScripts({ ids: [CAPTURE_ID] });

  if (!granted) {
    if (registered) await browser.scripting.unregisterContentScripts({ ids: [CAPTURE_ID] });
    return;
  }
  if (!registered) {
    await browser.scripting.registerContentScripts([CAPTURE_SCRIPT]);
  } else if (String(registered.js) !== String(CAPTURE_SCRIPT.js)) {
    // a registration persisted from an older version keeps that version's file list
    await browser.scripting.updateContentScripts([CAPTURE_SCRIPT]);
  }
}

browser.permissions.onAdded.addListener(syncCapture);
browser.permissions.onRemoved.addListener(syncCapture);
syncCapture();

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type === "openOptions") {
    await browser.runtime.openOptionsPage();
    return { ok: true };
  }

  if (message?.type === "refresh") return fetchResult();

  if (message?.type === "token") {
    const config = await getConfig();
    await browser.storage.local.set({
      [CONFIG_KEY]: { ...config, token: message.token }
    });
    return { ...(await fetchResult()), saved: true };
  }
});
