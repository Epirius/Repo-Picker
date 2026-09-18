const noop = () => {};
const listener = { addListener: noop };
const resolve = (value) => Promise.resolve(value);

globalThis.browser = {
  storage: { local: { get: () => resolve({}), set: () => resolve() } },
  omnibox: {
    setDefaultSuggestion: noop,
    onInputStarted: listener,
    onInputChanged: listener,
    onInputEntered: listener
  },
  alarms: { create: noop, onAlarm: listener },
  runtime: { onMessage: listener },
  windows: { getCurrent: () => resolve({ width: 0 }) },
  tabs: { create: noop, update: noop },
  permissions: { contains: () => resolve(false), onAdded: listener, onRemoved: listener },
  scripting: {
    getRegisteredContentScripts: () => resolve([]),
    registerContentScripts: () => resolve(),
    updateContentScripts: () => resolve(),
    unregisterContentScripts: () => resolve()
  }
};

load("https-url.js");
load("background.js");

const owner = "acme";
const repos = [
  "ledger-api",
  "ledger-engine",
  "ledger-service",
  "ledger-portal-ws",
  "ledger-service-api",
  "ledger-deployments",
  "ledger-domain-notes"
].map((name) => ({
  name,
  owner,
  fullName: `${owner}/${name}`,
  url: `https://github.com/${owner}/${name}`,
  description: `${name} is owned and maintained by the ledger team`,
  archived: false,
  pushedAt: Date.now()
}));

repos.push({
  name: "ledger-domain-notes",
  owner: "octocat",
  fullName: "octocat/ledger-domain-notes",
  url: "https://github.com/octocat/ledger-domain-notes",
  description: "",
  archived: true,
  pushedAt: 0
});

function suggestionsFor(list) {
  const nameCount = new Map();
  for (const repo of list) nameCount.set(repo.name, (nameCount.get(repo.name) || 0) + 1);
  links = new Map();
  return list.map((repo) => {
    const content = nameCount.get(repo.name) === 1 ? repo.name : repo.fullName;
    links.set(content, repo.url);
    return { content, description: describe(repo) };
  });
}

for (const width of [560, 900, 1522]) {
  windowWidth = width;
  print(`--- window ${width}px ---`);
  for (const row of suggestionsFor(repos)) {
    print(`  ${row.description}   [gh ${row.content}]`);
  }
}

print("--- resolving the content back to a url ---");
suggestionsFor(repos);
for (const content of [...links.keys(), "acme/not-indexed", "ledger"]) {
  print(`  ${content}  ->  ${resolveLink(content) ?? "(falls through to search)"}`);
}

print("--- ranking for 'uf' ---");
const ranked = repos
  .map((repo) => ({ repo, value: score(repo, "uf") }))
  .filter((r) => r.value !== null)
  .sort((a, b) => b.value - a.value || b.repo.pushedAt - a.repo.pushedAt);
for (const { repo, value } of ranked) print(`  ${value}\t${repo.fullName}`);

print("--- ranking for 'usa' (fuzzy) ---");
const fuzzy = repos
  .map((repo) => ({ repo, value: score(repo, "usa") }))
  .filter((r) => r.value !== null)
  .sort((a, b) => b.value - a.value);
for (const { repo, value } of fuzzy) print(`  ${value}\t${repo.fullName}`);
