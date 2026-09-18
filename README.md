# Repo Picker

A browser address bar keyword that autocompletes repository names.

Type `gh`, press space, then start typing. Matching repos appear in the dropdown.
Arrow down, Enter, you are on the repo. Enter without picking anything runs a GitHub
search scoped to your orgs instead.

Repo names are fetched once from the GitHub API and cached in the browser profile,
then refreshed every six hours. Filtering happens locally, so there is no request per
keystroke.

## Changing the keyword

```
./set-keyword.py repo
```

That rewrites `manifest.json`, bumps the patch version and rebuilds `repo-picker.zip`. Run
it with no argument to print the current keyword. Then reload: hit Reload in
`about:debugging` for a temporary install, or re-sign the zip for a permanent one.

There is no way to do this from inside the browser. The keyword is fixed in the
manifest, `browser.omnibox` has no method to change it, and there is no preferences UI
for extension keywords. The open request for one is
[bug 1361327](https://bugzilla.mozilla.org/show_bug.cgi?id=1361327). Editing the file and
reloading is the whole story.

## What a row shows

The repo name comes first, because the browser bolds whatever you typed and that is where you
want the bold to land. Everything after it drops away as the window narrows:

| Window width | Row |
| --- | --- |
| under 800px | `ledger-api` |
| 800px and up | `ledger-api · acme` |
| 1200px and up | `ledger-api · acme · description` |

Width comes from `browser.windows.getCurrent()`, read once when you open the dropdown.
The two thresholds are `OWNER_MIN_PX` and `DESCRIPTION_MIN_PX` at the top of
`background.js`. Setting either absurdly high turns that column off for good.

The browser also draws the suggestion's `content` on the right, and gives it the space it
wants before truncating the description. So `content` is `ledger-api` rather than the full
URL, and `onInputEntered` maps it back. A bare name is used when it is unique among the
visible rows, `org/name` when two orgs have the same repo name.

The browser renders `description` as plain text. Chrome's `<match>` and `<dim>` markup shows up
literally, so there is none here, and there is no way to bold anything yourself.

## What gets indexed

Every repository you can read under the accounts listed on the options page, plus three
independent toggles:

- repositories you own or collaborate on, via `/user/repos`
- repositories you have starred, via `/user/starred`
- repositories owned by accounts you follow, via `/user/following` then `/users/{login}/repos`

The last one costs one request per account you follow, capped at six in flight, so it is
the slow one. An account that vanishes between the two calls is skipped instead of failing
the run. Duplicates across sources collapse on full name.

## The accounts field

Entries separate on commas, newlines or both. Each one can be a bare name or any GitHub
URL for it, so all of these mean the same account:

```
acme
@acme
github.com/acme
https://github.com/acme
https://github.com/orgs/acme/repositories
https://github.com/acme/some-repo
```

Names are deduplicated case insensitively, and anything that is not a valid GitHub login
is dropped rather than sent to the API.

Organizations and users both work. A bare name does not say which it is, so indexing tries
`/orgs/{name}/repos` first and falls back to `/users/{name}/repos` on a 404. Which one
answered is remembered, so the fallback GitHub search built from Enter uses `org:` or
`user:` correctly.

Parsing lives in `orgs.js` rather than `options.js` so `test-orgs.js` can exercise it
directly.

## Matching

In priority order: exact name, name prefix, `org/name` prefix, substring, then a
subsequence match. `pfsl` finds `pensjon-fellesdata-sak-legacy`. Archived repos sink
to the bottom. Ties break toward the most recently pushed repo.

## Install

### Try it first

1. Open `about:debugging#/runtime/this-firefox`
2. Load Temporary Add-on, pick `manifest.json` from this folder
3. The options page opens from `about:addons` under this extension's Preferences

This version disappears when the browser restarts.

### Keep it

Release builds refuse unsigned extensions, so a permanent install means getting it
signed. Signing is free and an unlisted add-on skips review.

1. `python3 build.py`
2. Go to https://addons.mozilla.org/developers/addon/submit/distribution
3. Choose "On your own" for distribution, upload the zip
4. Download the signed `.xpi`
5. `about:addons` → gear icon → Install Add-on From File

Changing the extension means bumping `version` in `manifest.json` and repeating that.

The alternative is a developer, nightly or ESR build, where setting
`xpinstall.signatures.required` to `false` in `about:config` lets an unsigned add-on
install permanently. The pref does nothing on release builds.

## Releasing

`build.py` copies the packaged files into `dist/` and zips them. The tests, this README
and the workflow stay out of the build, so what the browser loads is only what it runs.

`run-tests.js` runs every harness under Node, which is how CI runs them. On a Mac they
also run one at a time under Safari's engine, `jsc test-orgs.js`, which needs nothing
installed.

`.github/workflows/release.yml` tests, builds, and submits to addons.mozilla.org. It needs
two repository secrets, `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`, generated under API keys in
the AMO Developer Hub.

Cutting a release is two steps.

1. Bump `version` in `manifest.json`, since AMO refuses a version it has already seen
2. Commit, then `git tag v1.0.18 && git push --tags`

The tag has to match the manifest version, or the build stops before anything is uploaded.
A `v*` tag publishes to the listed channel. Running the workflow by hand from the Actions
tab offers `unlisted` instead, which is signed on the spot and attached to the GitHub
release as an `.xpi` you can install directly.

The first listed version still has to go through the submission form by hand, because AMO
wants a name, summary, category and license before a listing exists. Every version after
that is the workflow's job. Listed versions wait in a review queue, so the job uploads and
exits rather than sitting on the queue until it times out.

## Token

Prefer a fine-grained token. Resource owner set to the organization, then
`Repository permissions → Metadata → Read-only`, and nothing else. That one permission is
what listing repositories needs, and it cannot write anything. Some orgs make an admin
approve fine-grained tokens first.

The classic button exists because that page can be prefilled:

```
https://github.com/settings/tokens/new?description=Repo%20Picker&scopes=repo&default_expires_at=none
```

`description`, `scopes` (comma separated) and `default_expires_at` (a day count, or
`none`) are prefill parameters GitHub supports there. The fine-grained page ignores them.

### Why classic asks for so much

`repo` is the only classic scope that lists private org repos, and GitHub documents it as
"full access to public and private repositories including read and write access to code,
commit statuses, repository invitations, collaborators, deployment statuses, and
repository webhooks."

The boxes that tick themselves underneath it, `repo:status`, `repo_deployment`,
`public_repo`, `repo:invite` and `security_events`, are subsets of `repo`, not extras we
ask for. Ticking the parent grants all of it and locks the children on. Untick `repo` and
they become selectable, but none of them can list private repos, so the extension stops
working. `public_repo` alone works if every repo you care about is public.

There is no read-only classic scope for private repositories. That is the whole reason to
use a fine-grained token here.

### Single sign-on

If the org uses SAML single sign-on, open the new token's page and authorize it for the
org, or the API returns the org's public repos only.

### Skipping the copy and paste

The org list, token field and checkbox are written to storage as you type, not only when
you click Save and fetch. Without that, creating a token in another tab picks up whatever
was last saved rather than what is on screen, and a first run fails with no organization
set. Save and fetch still does the explicit fetch.

The options page has a checkbox for capturing tokens from the GitHub settings page. Tick
it and the browser asks for access to `github.com/settings/*`. A content script then watches
that page for a freshly generated token and shows a bar offering to save it.

It is off by default and the permission is optional, so nothing is registered until you
ask for it. Untick the box and the content script is unregistered and the permission
dropped. The prompt never stores anything until you click Save.

The script matches on the token format, `ghp_` plus 36 characters or `github_pat_` plus
82, so the truncated prefixes listed on the token index page do not trigger it. Only the
full value GitHub shows you once, right after creation.

### Storage

The token sits in `browser.storage.local` for this profile, as plain text. The browser offers
extensions no encrypted storage and no route to the OS keychain, so that file in the
profile folder is the only place to put it, and any program running as the same user can
read it. The options page says so rather than leaving people to assume otherwise.

It also says what to do about it. Searching reads the cached list, not GitHub, so once a
fetch has finished the token earns nothing by staying. Forget token leaves every
repository already fetched searchable, and nothing on disk worth stealing. The cost is
that repositories created afterwards need a token pasted back in and another fetch. For anyone
who keeps one saved, the classic button asks for six months through the same
`default_expires_at` parameter that used to say `none`.

### Expiry

Every authenticated response carries `GitHub-Authentication-Token-Expiration` when the
token has an expiry date. That date is stored with the index, shown on the options page,
and shown in the popup once it is within a fortnight. A refresh with a date already past
fails before making a request, saying when it expired. Changing the token clears the
remembered date, so a fresh token is never judged by the old one's deadline.

### Where the token can be sent

The token leaves the browser only in requests to `api.github.com`. Pagination follows the
`Link` header, so that header is checked against the API host before the next request
carries the token, and a
GitHub response that suggests a link for the user to click can only produce an `https:`
one. Both guards assume a hostile response, which is what a TLS-intercepting proxy can
produce without compromising GitHub itself.

## Files

- `manifest.json` permissions, the keyword, the extension id
- `background.js` fetching, caching, scoring, the omnibox handlers
- `options.html` / `options.js` org list, token, manual refresh
- `capture.js` optional content script that offers to save a new token
- `https-url.js` the scheme check shared by every page that renders a link
- `expiry.js` parses the expiry header and phrases the warning
- `build.py` copies the packaged files into `dist/` and zips them
- `set-keyword.py` rewrites the keyword and repackages
- `run-tests.js` runs the test harnesses under Node
- `.github/workflows/release.yml` tests, builds and submits to addons.mozilla.org
