const TOKEN_RE = /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,})\b/;
const BANNER_ID = "gh-omnibox-banner";

let timer = null;

function findToken() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const match = node.nodeValue.match(TOKEN_RE);
    if (match) return match[1];
  }
  return null;
}

function styleButton(button) {
  button.style.cssText =
    "font:inherit;font-weight:600;padding:4px 12px;border-radius:6px;" +
    "border:1px solid rgba(255,255,255,0.55);background:transparent;color:inherit;cursor:pointer";
}

function actionButton(result) {
  if (result.actionMessage) {
    const button = document.createElement("button");
    button.textContent = result.actionLabel || "Fix this";
    styleButton(button);
    button.addEventListener("click", () => {
      browser.runtime.sendMessage({ type: result.actionMessage });
    });
    return button;
  }

  if (result.actionUrl) {
    const link = document.createElement("a");
    link.href = result.actionUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = result.actionLabel || "Fix this";
    styleButton(link);
    link.style.textDecoration = "none";
    return link;
  }

  return null;
}

function showBanner(token) {
  const bar = document.createElement("div");
  bar.id = BANNER_ID;
  bar.style.cssText =
    "position:fixed;inset:0 0 auto 0;z-index:2147483647;display:flex;gap:12px;" +
    "align-items:center;justify-content:center;padding:10px 16px;background:#1f6feb;" +
    "color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 1px 6px rgba(0,0,0,0.3)";

  const text = document.createElement("span");
  text.textContent = "Save this token to the GitHub repo omnibox?";

  const save = document.createElement("button");
  save.textContent = "Save";
  const dismiss = document.createElement("button");
  dismiss.textContent = "Dismiss";
  styleButton(save);
  styleButton(dismiss);

  save.addEventListener("click", async () => {
    save.disabled = true;
    text.textContent = "Saving...";
    try {
      const result = await browser.runtime.sendMessage({ type: "token", token });
      if (result.ok) {
        text.textContent = `Saved. ${result.count} repositories cached.`;
      } else {
        text.textContent = `Token saved. ${result.error}`;
        const action = actionButton(result);
        if (action) bar.insertBefore(action, dismiss);
      }
    } catch (err) {
      text.textContent = `Could not reach the extension: ${err.message || err}`;
    }
    save.remove();
    dismiss.textContent = "Close";
  });

  dismiss.addEventListener("click", () => bar.remove());

  bar.append(text, save, dismiss);
  document.body.prepend(bar);
}

function scan() {
  if (document.getElementById(BANNER_ID)) return true;
  const token = findToken();
  if (!token) return false;
  showBanner(token);
  return true;
}

if (!scan()) {
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (scan()) observer.disconnect();
    }, 200);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
