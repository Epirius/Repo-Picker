const noop = () => {};
const listener = { addListener: noop };
const resolve = (v) => Promise.resolve(v);

const config = {
  orgs: ["acme"],
  token: "ghp_test",
  includePersonal: true,
  includeStarred: true,
  includeFollowing: true
};

const requested = [];

globalThis.browser = {
  storage: {
    local: {
      get: (key) => resolve(key === "config" ? { config } : {}),
      set: () => resolve()
    },
    onChanged: listener
  },
  omnibox: { setDefaultSuggestion: noop, onInputStarted: listener, onInputChanged: listener, onInputEntered: listener },
  alarms: { create: noop, onAlarm: listener },
  runtime: { onMessage: listener, openOptionsPage: () => resolve() },
  windows: { getCurrent: () => resolve({ width: 1400 }) },
  tabs: { create: noop, update: noop },
  permissions: { contains: () => resolve(false), onAdded: listener, onRemoved: listener },
  scripting: {
    getRegisteredContentScripts: () => resolve([]),
    registerContentScripts: () => resolve(),
    unregisterContentScripts: () => resolve()
  }
};

function repo(owner, name) {
  return {
    full_name: `${owner}/${name}`,
    name,
    owner: { login: owner },
    html_url: `https://github.com/${owner}/${name}`,
    description: "",
    archived: false,
    pushed_at: "2026-09-01T00:00:00Z"
  };
}

globalThis.fetch = (url) => {
  requested.push(url.replace("https://api.github.com", ""));
  let body = [];
  if (url.includes("/orgs/")) body = [repo("acme", "ledger-api")];
  else if (url.includes("/user/repos")) body = [repo("hubot", "dotfiles")];
  else if (url.includes("/user/starred")) body = [repo("microsoft", "vscode"), repo("hubot", "dotfiles")];
  else if (url.includes("/user/following")) body = [{ login: "octocat" }, { login: "ghost" }];
  else if (url.includes("/users/octocat/repos")) body = [repo("octocat", "hello-world")];
  else if (url.includes("/users/ghost/repos")) return Promise.reject(new Error("gone"));
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { get: () => null }
  });
};

load("background.js");

(async () => {
  const cache = await refreshRepos();
  print("requests made:");
  for (const r of requested.sort()) print("  " + r);
  print("");
  print("indexed:");
  for (const r of cache.repos) print(`  ${r.fullName}`);
  print("");
  print(`total ${cache.repos.length} (duplicate hubot/dotfiles collapsed: ${cache.repos.filter((r) => r.fullName === "hubot/dotfiles").length === 1})`);
  print(`failing followed account did not abort the run: ${cache.repos.some((r) => r.owner === "octocat")}`);
})();
