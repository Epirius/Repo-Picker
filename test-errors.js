const noop = () => {};
const listener = { addListener: noop };
const resolve = (value) => Promise.resolve(value);

globalThis.browser = {
  storage: { local: { get: () => resolve({}), set: () => resolve() }, onChanged: listener },
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

function fakeResponse(status, body, headers = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, text: () => Promise.resolve(body), headers: { get: (k) => lower.get(k.toLowerCase()) ?? null } };
}

const ORG_URL = "https://api.github.com/orgs/acme/repos?per_page=100";

const cases = [
  [
    "SAML, with the header GitHub actually sends",
    fakeResponse(
      403,
      JSON.stringify({
        message:
          "Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.",
        documentation_url: "https://docs.github.com/articles/authenticating-with-saml-single-sign-on"
      }),
      {
        "X-GitHub-SSO":
          "required; url=https://github.com/orgs/acme/sso?authorization_request=AB1CDEF"
      }
    ),
    ORG_URL
  ],
  [
    "SAML, header stripped",
    fakeResponse(403, JSON.stringify({ message: "Resource protected by organization SAML enforcement." })),
    ORG_URL
  ],
  [
    "SAML, with a header that tries to smuggle a script url",
    fakeResponse(403, JSON.stringify({ message: "Resource protected by organization SAML enforcement." }), {
      "X-GitHub-SSO": "required; url=javascript:alert(document.domain)"
    }),
    ORG_URL
  ],
  ["bad token", fakeResponse(401, JSON.stringify({ message: "Bad credentials" })), ORG_URL],
  [
    "rate limited",
    fakeResponse(403, JSON.stringify({ message: "API rate limit exceeded for user 1234." })),
    ORG_URL
  ],
  ["misspelled org", fakeResponse(404, JSON.stringify({ message: "Not Found" })), ORG_URL],
  ["something else", fakeResponse(500, "<html>upstream boom</html>"), ORG_URL]
];

(async () => {
  for (const [label, res, url] of cases) {
    const err = await githubError(res, url);
    print(`${label}:`);
    print(`  message: ${err.message}`);
    print(`  action:  ${err.actionLabel ?? "(none)"} -> ${err.actionUrl ?? "(none)"}`);
  }

  print("");
  print("pagination targets:");
  const linkCases = [
    ['<https://api.github.com/orgs/x/repos?page=2>; rel="next"', "next page on the API host"],
    ['<https://api.github.com.evil.example/repos?page=2>; rel="next"', "lookalike host"],
    ['<https://api.github.com@evil.example/repos>; rel="next"', "userinfo trick"],
    ['<http://api.github.com/orgs/x/repos?page=2>; rel="next"', "downgraded to http"],
    ['<https://api.github.com\t@evil.example/repos>; rel="next"', "tab that fetch strips"],
    ['<https://api.github.com\\@evil.example/repos>; rel="next"', "backslash as separator"],
    ['<https://evil.example/repos>; rel="prev"', "no next link at all"]
  ];
  for (const [header, label] of linkCases) {
    try {
      print(`  ${label}: ${nextPageUrl(header) ?? "(stop)"}`);
    } catch (err) {
      print(`  ${label}: refused, ${err.message}`);
    }
  }

  print("");
  print("config errors (no network call made):");
  for (const message of ["No access token saved yet.", "No organization saved yet."]) {
    const err = configError(message);
    print(`  ${err.message}`);
    print(`    action: ${err.actionLabel} -> sends {type: "${err.actionMessage}"}`);
  }
})();
