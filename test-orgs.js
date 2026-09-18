load("orgs.js");

const cases = [
  ["acme", ["acme"], "bare name"],
  ["https://github.com/acme", ["acme"], "full url"],
  ["https://github.com/acme/", ["acme"], "trailing slash"],
  ["github.com/acme", ["acme"], "no scheme"],
  ["http://www.github.com/acme", ["acme"], "http and www"],
  ["https://github.com/orgs/acme/repositories", ["acme"], "orgs path"],
  ["https://github.com/users/octocat", ["octocat"], "users path"],
  ["https://github.com/acme/some-repo", ["acme"], "repo url falls back to owner"],
  ["https://github.com/acme?tab=repositories", ["acme"], "query string"],
  ["@octocat", ["octocat"], "at prefix"],
  ["a, b, c", ["a", "b", "c"], "comma separated"],
  ["a\nb\nc", ["a", "b", "c"], "newline separated"],
  ["a, b\nc,  d", ["a", "b", "c", "d"], "mixed separators"],
  ["acme\nhttps://github.com/acme\nACME", ["acme"], "dedup, case insensitive"],
  ["", [], "empty"],
  ["   \n  ", [], "whitespace only"],
  ["https://gitlab.com/acme", [], "wrong host is rejected"],
  ["-leading-hyphen", [], "invalid login"],
  ["a".repeat(40), [], "too long for a github login"]
];

let failures = 0;
for (const [input, expected, label] of cases) {
  const got = parseOrgs(input);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failures += 1;
  print(`${ok ? "pass" : "FAIL"}  ${label}`);
  if (!ok) print(`        got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}
print(failures ? `${failures} failing` : "all org parsing cases pass");
