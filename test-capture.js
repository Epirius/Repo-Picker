(0, eval)(read("capture.js").split("\n")[0].replace("const ", "var "));

const cases = [
  ["ghp_" + "a".repeat(36), true, "classic token"],
  ["Make sure to copy it now. ghp_" + "b".repeat(36) + " You won't see it again!", true, "in prose"],
  ["github_pat_" + "c".repeat(82), true, "fine-grained token"],
  ["ghp_abc123", false, "truncated prefix from the token list"],
  ["ghp_" + "d".repeat(20), false, "too short"],
  ["github_pat_" + "e".repeat(10), false, "fine-grained, too short"],
  ["gh-omnibox repo listing", false, "ordinary page text"],
  ["Personal access tokens (classic)", false, "page heading"]
];

let failures = 0;
for (const [input, expected, label] of cases) {
  const got = TOKEN_RE.test(input);
  const ok = got === expected;
  if (!ok) failures += 1;
  print(`${ok ? "pass" : "FAIL"}  ${expected ? "match " : "ignore"}  ${label}`);
}
print(failures ? `${failures} failing` : "all capture cases pass");
