load("expiry.js");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-18T12:00:00Z");

const parsed = [
  ["2027-03-18 15:00:00 UTC", Date.parse("2027-03-18T15:00:00Z"), "the header GitHub sends"],
  ["2027-03-18 15:00:00 +0100", Date.parse("2027-03-18T14:00:00Z"), "offset without a colon"],
  ["2027-03-18 15:00:00 +01:00", Date.parse("2027-03-18T14:00:00Z"), "offset with a colon"],
  ["2027-03-18T15:00:00Z", Date.parse("2027-03-18T15:00:00Z"), "plain iso"],
  ["", 0, "no header, a token that never expires"],
  [null, 0, "header absent"],
  ["whenever", 0, "nonsense"]
];

let failures = 0;

for (const [input, expected, label] of parsed) {
  const got = parseExpiry(input);
  const ok = got === expected;
  if (!ok) failures += 1;
  print(`${ok ? "pass" : "FAIL"}  parse   ${label}${ok ? "" : ` (got ${got}, wanted ${expected})`}`);
}

const notes = [
  [0, "", "nothing known"],
  [NOW - DAY, /^The token expired on /, "a day past"],
  [NOW + 1, /expires in 1 day,/, "minutes left"],
  [NOW + 5 * DAY, /expires in 5 days,/, "closing in"],
  [NOW + 14 * DAY, /expires in 14 days,/, "on the warning edge"],
  [NOW + 30 * DAY, /^The token expires on /, "plenty of time"]
];

for (const [expiresAt, expected, label] of notes) {
  const note = expiryNote(expiresAt, NOW);
  const ok = expected === "" ? note === "" : expected.test(note);
  if (!ok) failures += 1;
  print(`${ok ? "pass" : "FAIL"}  note    ${label}: ${note || "(nothing)"}`);
}

const soon = [
  [0, false, "nothing known"],
  [NOW - DAY, true, "already expired"],
  [NOW + 13 * DAY, true, "inside the window"],
  [NOW + 15 * DAY, false, "outside it"]
];

for (const [expiresAt, expected, label] of soon) {
  const ok = expiringSoon(expiresAt, NOW) === expected;
  if (!ok) failures += 1;
  print(`${ok ? "pass" : "FAIL"}  warn    ${label}`);
}

print(failures ? `${failures} failing` : "all expiry cases pass");
