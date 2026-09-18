# GitHub repo omnibox

A Firefox address bar keyword that autocompletes repository names.

Type `gh`, press space, then start typing. Matching repos appear in the dropdown.
Arrow down, Enter, you are on the repo. Enter without picking anything runs a GitHub
search scoped to your orgs instead.

Repo names are fetched once from the GitHub API and cached in the browser profile,
then refreshed every six hours. Filtering happens locally, so there is no request per
keystroke.

## Matching

In priority order: exact name, name prefix, `org/name` prefix, substring, then a
subsequence match. `pfsl` finds `pensjon-fellesdata-sak-legacy`. Archived repos sink
to the bottom. Ties break toward the most recently pushed repo.

## Install

### Try it first

1. Open `about:debugging#/runtime/this-firefox`
2. Load Temporary Add-on, pick `manifest.json` from this folder
3. The options page opens from `about:addons` under this extension's Preferences

This version disappears when Firefox restarts.

### Keep it

Firefox release builds refuse unsigned extensions, so a permanent install means getting
it signed. Signing is free and an unlisted add-on skips review.

1. `zip -r -FS gh-omnibox.zip . -x '*.git*' 'gh-omnibox.zip'`
2. Go to https://addons.mozilla.org/developers/addon/submit/distribution
3. Choose "On your own" for distribution, upload the zip
4. Download the signed `.xpi`
5. `about:addons` → gear icon → Install Add-on From File

Changing the extension means bumping `version` in `manifest.json` and repeating that.

The alternative is Firefox Developer Edition, Nightly or ESR, where setting
`xpinstall.signatures.required` to `false` in `about:config` lets an unsigned add-on
install permanently. The pref does nothing on release builds.

## Token

The options page takes either kind of GitHub token.

A fine-grained token needs `Metadata: read` and, importantly, the resource owner set to
the organization rather than your own account. Some orgs require an admin to approve
fine-grained tokens before they work.

A classic token needs the `repo` scope. If the org uses SAML single sign-on, open the
token's settings page afterwards and authorize it for that org, or the API returns the
org's public repos only.

The token sits in `browser.storage.local` for this profile. It never leaves the browser
except in requests to `api.github.com`.

## Files

- `manifest.json` permissions, the `gh` keyword, the Firefox extension id
- `background.js` fetching, caching, scoring, the omnibox handlers
- `options.html` / `options.js` org list, token, manual refresh
