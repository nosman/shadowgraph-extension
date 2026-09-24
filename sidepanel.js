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

// Same source icons as the repo page's SocialMentionsTable: HN's favicon
// (via Google's favicon service, like the site's Favicon component) and
// Tabler's brand-reddit / brand-x outlines, drawn inline so they take the
// text color in both themes. Tabler Icons, MIT License.
const TABLER_PATHS = {
  reddit: [
    ["M12 8c2.648 0 5.028 .826 6.675 2.14a2.5 2.5 0 0 1 2.326 4.36c0 3.59 -4.03 6.5 -9 6.5c-4.875 0 -8.845 -2.8 -9 -6.294l-1 -.206a2.5 2.5 0 0 1 2.326 -4.36c1.646 -1.313 4.026 -2.14 6.674 -2.14l.999 0"],
    ["M12 8l1 -5l6 1"],
    ["M18 4a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"],
    ["M8.5 13a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0", "currentColor"],
    ["M14.5 13a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0", "currentColor"],
    ["M10 17c.667 .333 1.333 .5 2 .5s1.333 -.167 2 -.5"],
  ],
  twitter: [["M4 4l11.733 16h4.267l-11.733 -16l-4.267 0"], ["M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772"]],
};
const SOURCE_LABELS = { hackernews: "Hacker News", twitter: "X", reddit: "Reddit" };

function sourceIcon(source) {
  if (source === "hackernews") {
    const img = h("img", {
      class: "source-icon",
      src: "https://www.google.com/s2/favicons?sz=32&domain=news.ycombinator.com",
      alt: SOURCE_LABELS.hackernews,
    });
    img.addEventListener("error", () => img.replaceWith(h("span", { class: "source-icon placeholder" })));
    return img;
  }
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "source-icon");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", SOURCE_LABELS[source]);
  for (const [d, fill] of TABLER_PATHS[source]) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", fill ?? "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.75");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}

function mentionRow(m) {
  // `content` is the headline in the repo page's own rows (toMentionRows);
  // servers deployed before that sent it as `title`.
  const headline = m.content ?? m.title;
  return h(
    "tr",
    {},
    h("td", {}, sourceIcon(m.source)),
    h(
      "td",
      { class: "message" },
      h(
        "a",
        { class: "mention-link", href: m.url, target: "_blank", rel: "noopener noreferrer" },
        h("span", { class: "mention-title" }, headline),
        m.snippet && h("span", { class: "mention-snippet" }, m.snippet),
      ),
    ),
    h("td", { class: "num" }, m.points.toLocaleString()),
    h("td", { class: "date" }, formatDate(m.postedAt)),
  );
}

/** Small segmented control — one selected option, `onChange(value)` on click. */
function segmented(options, value, onChange) {
  const group = h("div", { class: "segmented" });
  const render = (selected) => {
    group.replaceChildren(
      ...options.map(([key, label]) =>
        h(
          "button",
          {
            type: "button",
            "aria-pressed": String(key === selected),
            onclick: () => {
              render(key);
              onChange(key);
            },
          },
          label,
        ),
      ),
    );
  };
  render(value);
  return group;
}

/** The repo page's "See what people are saying" table, sized for the panel: source filter (offering only sources that have mentions, and only when there's more than one), sort, and one row per mention. */
function mentionsView(mentions) {
  if (mentions.length === 0) return h("p", { class: "muted" }, "No mentions found.");
  let source = "all";
  let sort = "chronological";
  const body = h("tbody");
  const render = () => {
    const rows = (source === "all" ? mentions : mentions.filter((m) => m.source === source))
      .slice()
      .sort((a, b) => (sort === "points" ? b.points - a.points : new Date(b.postedAt) - new Date(a.postedAt)));
    body.replaceChildren(...rows.map(mentionRow));
  };
  render();

  const sources = new Set(mentions.map((m) => m.source));
  return h(
    "div",
    {},
    h(
      "div",
      { class: "controls" },
      sources.size > 1 &&
        segmented(
          [["all", "All sources"], ...Object.entries(SOURCE_LABELS).filter(([key]) => sources.has(key))],
          source,
          (value) => {
            source = value;
            render();
          },
        ),
      segmented(
        [
          ["chronological", "Newest first"],
          ["points", "Most points"],
        ],
        sort,
        (value) => {
          sort = value;
          render();
        },
      ),
    ),
    h(
      "table",
      { class: "mentions" },
      h("thead", {}, h("tr", {}, h("th", { "aria-label": "Source" }), h("th", {}, "Message"), h("th", {}, "Score"), h("th", {}, "Date"))),
      body,
    ),
  );
}

const SIMILAR_PAGE_SIZE = 10;

/** Similar repos, SIMILAR_PAGE_SIZE at a time. */
function similarView(similar, viewer) {
  if (similar.length === 0) return h("p", { class: "muted" }, "No similar repos found.");
  const list = h("ul");
  const more = h("button", { type: "button", class: "button show-more" }, "Show more");
  let shown = 0;
  const showMore = () => {
    list.append(...similar.slice(shown, shown + SIMILAR_PAGE_SIZE).map((r) => repoItem(r, viewer)));
    shown += SIMILAR_PAGE_SIZE;
    more.hidden = shown >= similar.length;
  };
  more.addEventListener("click", showMore);
  showMore();
  return h("div", {}, list, more);
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
    similar: similarView(similar, viewer),
    mentions: mentionsView(mentions),
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
