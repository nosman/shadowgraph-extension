import { detectPage, fetchFolders, fetchPage, getBaseUrl, removeBookmark, saveBookmark, shadowgraphRepoPath } from "./lib.js";

const content = document.getElementById("content");
const account = document.getElementById("account");
const BOOKMARK_PATH = "M18 7v14l-6-4-6 4V7a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4z";

const baseUrl = await getBaseUrl();
document.getElementById("home").href = baseUrl;

/** Tiny element builder: h("a", { href }, "text", childNode). Strings become text nodes, never HTML. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) el.append(child);
  }
  return el;
}

function bookmarkIcon(filled) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", BOOKMARK_PATH);
  path.setAttribute("fill", filled ? "currentColor" : "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function formatCount(n) {
  if (n == null) return null;
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function setMessage(...children) {
  content.replaceChildren(h("p", { class: "muted" }, ...children));
}

function renderAccount(viewer) {
  account.replaceChildren(
    viewer.signedIn
      ? h("a", { href: `${baseUrl}/folders`, target: "_blank" }, "Folders")
      : h("a", { href: `${baseUrl}/login`, target: "_blank" }, "Sign in"),
  );
}

/** Folder tree flattened depth-first under the root, with indented labels for a <select>. */
function flattenFolders(folders, rootId) {
  const children = new Map();
  for (const f of folders) {
    const list = children.get(f.parentId) ?? [];
    list.push(f);
    children.set(f.parentId, list);
  }
  const out = [];
  const walk = (folder, depth) => {
    out.push({ id: folder.id, label: `${"   ".repeat(depth)}${folder.name}` });
    for (const child of children.get(folder.id) ?? []) walk(child, depth + 1);
  };
  const root = folders.find((f) => f.id === rootId);
  if (root) walk(root, 0);
  return out;
}

/** Bookmark toggle for one repo: signed out it links to sign-in; unsaved it opens a folder picker; saved it unsaves. */
function bookmarkControl(repoId, viewer) {
  const wrapper = h("div");
  if (!viewer.signedIn) {
    const link = h("a", { class: "bookmark", href: `${baseUrl}/login`, target: "_blank", title: "Sign in to save" });
    link.append(bookmarkIcon(false));
    wrapper.append(link);
    return { button: wrapper, picker: h("div") };
  }

  const pickerSlot = h("div");
  let saved = viewer.savedRepoIds.includes(repoId);
  const button = h("button", { class: "bookmark", type: "button" });
  const render = () => {
    button.setAttribute("aria-pressed", String(saved));
    button.title = saved ? "Remove from folders" : "Save to folder";
    button.replaceChildren(bookmarkIcon(saved));
  };
  render();

  const showError = (text) => pickerSlot.replaceChildren(h("div", { class: "error" }, text));

  button.addEventListener("click", async () => {
    if (saved) {
      button.disabled = true;
      const { ok } = await removeBookmark(repoId);
      button.disabled = false;
      if (!ok) return showError("Couldn't remove.");
      saved = false;
      pickerSlot.replaceChildren();
      render();
      return;
    }
    if (pickerSlot.firstChild) {
      pickerSlot.replaceChildren();
      return;
    }

    button.disabled = true;
    const { ok, body } = await fetchFolders(repoId);
    button.disabled = false;
    if (!ok) return showError("Couldn't load folders.");

    const options = flattenFolders(body.folders, body.rootFolderId);
    const { lastFolderId } = await chrome.storage.local.get("lastFolderId");
    const initial = options.some((o) => o.id === lastFolderId) ? lastFolderId : body.rootFolderId;
    const select = h("select", {}, options.map((o) => h("option", { value: o.id, selected: o.id === initial }, o.label)));
    const save = h("button", { type: "button", class: "primary" }, "Save");
    const cancel = h("button", { type: "button", onclick: () => pickerSlot.replaceChildren() }, "Cancel");
    save.addEventListener("click", async () => {
      const folderId = Number(select.value);
      save.disabled = true;
      const result = await saveBookmark(repoId, folderId);
      if (!result.ok) {
        save.disabled = false;
        return pickerSlot.append(h("div", { class: "error" }, "Couldn't save."));
      }
      await chrome.storage.local.set({ lastFolderId: folderId });
      saved = true;
      pickerSlot.replaceChildren();
      render();
    });
    pickerSlot.replaceChildren(h("div", { class: "picker" }, select, save, cancel));
  });

  return { button, picker: pickerSlot };
}

function hostLabel(url) {
  return /^https?:\/\/(www\.)?huggingface\.co\//i.test(url) ? "Hugging Face" : "GitHub";
}

/** Opens a repo on GitHub/Hugging Face in the current tab, so the panel follows to that repo. */
function hostLink(url) {
  return h(
    "a",
    {
      href: url,
      onclick: (event) => {
        event.preventDefault();
        chrome.tabs.update({ url });
      },
    },
    hostLabel(url),
  );
}

function paperLabel(paper) {
  return paper.source === "acm" ? `ACM ${paper.id}` : `arXiv:${paper.id}`;
}

/** Owner avatar + "owner/name", linked to the repo's Shadowgraph page. */
function repoName(repo) {
  const avatar = repo.avatarUrl && h("img", { class: "avatar", src: repo.avatarUrl, alt: "", width: 20, height: 20 });
  if (avatar) avatar.addEventListener("error", () => avatar.remove());
  return h("a", { class: "name", href: repo.shadowgraphUrl, target: "_blank" }, avatar, repo.fullName);
}

function repoItem(repo, viewer, extraMeta) {
  const { button, picker } = bookmarkControl(repo.id, viewer);
  const meta = [repo.stars != null ? `★ ${formatCount(repo.stars)}` : null, extraMeta].filter(Boolean).join(" · ");
  return h(
    "li",
    {},
    h(
      "div",
      { class: "row" },
      h(
        "div",
        { class: "row-main" },
        repoName(repo),
        h("div", { class: "meta" }, meta && `${meta} · `, hostLink(repo.url)),
        repo.description && h("div", { class: "desc" }, repo.description),
      ),
      button,
    ),
    picker,
  );
}

function renderPaper(page, { paper, repos, viewer }) {
  const title = paper.shadowgraphUrl
    ? h("a", { href: paper.shadowgraphUrl, target: "_blank" }, paper.title ?? paperLabel(paper))
    : paper.title ?? paperLabel(paper);
  content.replaceChildren(
    h("h1", {}, title),
    h("h2", {}, repos.length === 1 ? "1 citing repo" : `${repos.length} citing repos`),
    repos.length === 0
      ? h("p", { class: "muted" }, "No repos found.")
      : h("ul", {}, repos.map((r) => repoItem(r, viewer))),
  );
}

function mentionItem(m) {
  const source = { hackernews: "Hacker News", reddit: "Reddit", twitter: "X" }[m.source];
  const points = m.source === "twitter" ? `${m.points} likes` : `${m.points} points`;
  return h(
    "li",
    {},
    h("a", { class: "name", href: m.url, target: "_blank" }, m.title),
    m.snippet && h("div", { class: "snippet" }, m.snippet),
    h("div", { class: "meta" }, `${source} · ${points} · ${formatDate(m.postedAt)}`),
  );
}

function renderRepo({ repo, similar, mentions, viewer }) {
  const { button, picker } = bookmarkControl(repo.id, viewer);
  const current = h(
    "div",
    { class: "current" },
    h(
      "div",
      { class: "row", style: "padding: 0 12px" },
      h(
        "div",
        { class: "row-main" },
        repoName(repo),
        repo.stars != null && h("div", { class: "meta" }, `★ ${formatCount(repo.stars)}`),
      ),
      button,
    ),
    h("div", { style: "padding: 0 12px" }, picker),
  );

  const panels = {
    similar: similar.length
      ? h("ul", {}, similar.map((r) => repoItem(r, viewer)))
      : h("p", { class: "muted" }, "No similar repos found."),
    mentions: mentions.length
      ? h("ul", {}, mentions.map(mentionItem))
      : h("p", { class: "muted" }, "No mentions found."),
  };
  const panel = h("div");
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const select = async (key) => {
    for (const b of tabs.children) b.setAttribute("aria-selected", String(b.dataset.key === key));
    panel.replaceChildren(panels[key]);
    await chrome.storage.local.set({ repoTab: key });
  };
  for (const [key, label] of [
    ["similar", `Similar (${similar.length})`],
    ["mentions", `Mentions (${mentions.length})`],
  ]) {
    tabs.append(h("button", { type: "button", role: "tab", "data-key": key, onclick: () => select(key) }, label));
  }
  content.replaceChildren(current, tabs, panel);
  chrome.storage.local.get("repoTab").then(({ repoTab }) => select(panels[repoTab] ? repoTab : "similar"));
}

// The panel stays open across navigations and tab switches, so it re-renders
// for whatever the active tab in its own window is showing.
const windowId = (await chrome.windows.getCurrent()).id;
let shownKey = null;
let loadSeq = 0;

function pageKey(page) {
  return page ? JSON.stringify(page) : "none";
}

/**
 * Renders the panel for `url`. Skips a reload when the page is the same
 * paper/repo already shown (e.g. browsing a repo's files) unless `force` —
 * set on tab switches, so returning from signing in on the site picks up
 * the new bookmark state. A slower, older load never overwrites a newer one.
 */
async function load(url, force = false) {
  const page = url ? detectPage(url) : null;
  const key = pageKey(page);
  if (!force && key === shownKey) return;
  shownKey = key;
  const seq = ++loadSeq;

  if (!page) {
    setMessage("Open an arXiv or ACM paper, or a GitHub or Hugging Face repo.");
    return;
  }
  setMessage("Loading…");
  try {
    const { ok, status, body } = await fetchPage(page);
    if (seq !== loadSeq) return;
    if (ok) {
      renderAccount(body.viewer);
      if (page.kind === "paper") renderPaper(page, body);
      else renderRepo(body);
    } else if (status === 404 && page.kind === "repo") {
      setMessage(
        "Not on Shadowgraph yet. ",
        h("a", { href: `${baseUrl}${shadowgraphRepoPath(page)}`, target: "_blank" }, "Add it"),
      );
    } else {
      setMessage(`Couldn't load (${status}).`);
    }
  } catch {
    if (seq === loadSeq) setMessage("Couldn't reach Shadowgraph.");
  }
}

async function loadActiveTab(force) {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  await load(tab?.url, force);
}

chrome.tabs.onActivated.addListener((info) => {
  if (info.windowId === windowId) loadActiveTab(true);
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!tab.active || tab.windowId !== windowId) return;
  if (changeInfo.url || changeInfo.status === "complete") load(tab.url);
});

loadActiveTab(true);
