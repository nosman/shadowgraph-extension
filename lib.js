// Shared by background.js, sidepanel.js and options.js.

export const DEFAULT_BASE_URL = "https://shadowgraph.io";

export async function getBaseUrl() {
  const { baseUrl } = await chrome.storage.sync.get("baseUrl");
  return (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

const ARXIV_HOSTS = new Set(["arxiv.org", "www.arxiv.org"]);
const ARXIV_PATH = /^\/(?:abs|pdf|html|format)\/(.+?)(?:\.pdf)?\/?$/;
const NEW_STYLE_ID = /^(\d{4}\.\d{4,5})(?:v\d+)?$/;
const OLD_STYLE_ID = /^([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i;
const ACM_DOI_ID = /10\.1145\/([\w.-]+)/i;

// First path segments on github.com that aren't a user or org.
const GITHUB_RESERVED = new Set([
  "about", "account", "apps", "codespaces", "collections", "customer-stories", "dashboard",
  "enterprise", "explore", "features", "issues", "login", "marketplace", "new", "notifications",
  "orgs", "organizations", "pricing", "pulls", "readme", "search", "security", "settings",
  "signup", "sponsors", "topics", "trending", "users",
]);
const GITHUB_OWNER = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/;
const GITHUB_REPO = /^[\w.-]{1,100}$/;

// Mirrors HF_RESERVED_NAMESPACES / HF_VALID_*_RE in src/lib/hfValidation.ts.
const HF_RESERVED = new Set([
  "models", "datasets", "spaces", "docs", "blog", "learn", "tasks", "pricing", "enterprise", "join",
  "login", "settings", "organizations", "papers", "posts", "collections", "chat", "spaces-demo",
  "inference-api", "inference-endpoints", "support", "privacy", "terms-of-service", "search",
]);
const HF_OWNER = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const HF_NAME = /^[\w.-]{1,96}$/;
const HF_TYPE_PREFIXES = { datasets: "dataset", spaces: "space" };

// Sites the side panel is enabled on (see background.js) — every host
// detectPage recognizes. Deliberately per-site, not per-page: Chrome closes
// the panel on a tab where it gets disabled and won't reopen it without a
// click, so browsing to e.g. github.com/trending shouldn't close it.
const SUPPORTED_HOSTS = new Set([...ARXIV_HOSTS, "dl.acm.org", "github.com", "huggingface.co"]);

/** Whether `url` is on a site the extension works on. Undefined for a tab on any other site: without the "tabs" permission, Chrome only exposes a tab's URL on hosts the extension has permission for. */
export function isSupportedSite(url) {
  try {
    return SUPPORTED_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function arxivIdFrom(raw) {
  return raw?.match(NEW_STYLE_ID)?.[1] ?? raw?.match(OLD_STYLE_ID)?.[1] ?? null;
}

/**
 * What the page at `url` is, from Shadowgraph's point of view: a paper
 * ({ kind: "paper", source: "arxiv" | "acm", id }), a repo
 * ({ kind: "repo", host: "github" | "huggingface", owner, name, hfType? }),
 * or neither (null).
 */
export function detectPage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (ARXIV_HOSTS.has(parsed.hostname)) {
    const id = arxivIdFrom(parsed.pathname.match(ARXIV_PATH)?.[1]);
    return id ? { kind: "paper", source: "arxiv", id } : null;
  }
  if (parsed.hostname === "dl.acm.org") {
    const id = parsed.pathname.match(ACM_DOI_ID)?.[1];
    return id ? { kind: "paper", source: "acm", id } : null;
  }
  if (parsed.hostname === "github.com") {
    const [owner, name] = segments;
    if (!owner || !name || GITHUB_RESERVED.has(owner.toLowerCase())) return null;
    const repo = name.replace(/\.git$/, "");
    if (!GITHUB_OWNER.test(owner) || !GITHUB_REPO.test(repo)) return null;
    return { kind: "repo", host: "github", owner, name: repo };
  }
  if (parsed.hostname === "huggingface.co") {
    // huggingface.co/papers/{arxiv id} is Hugging Face's page for an arXiv paper.
    if (segments[0] === "papers") {
      const id = arxivIdFrom(segments[1]);
      return id ? { kind: "paper", source: "arxiv", id } : null;
    }
    let hfType = "model";
    let rest = segments;
    if (HF_TYPE_PREFIXES[segments[0]]) {
      hfType = HF_TYPE_PREFIXES[segments[0]];
      rest = segments.slice(1);
    }
    const [owner, name] = rest;
    if (!owner || !name || HF_RESERVED.has(owner.toLowerCase())) return null;
    if (!HF_OWNER.test(owner) || !HF_NAME.test(name)) return null;
    return { kind: "repo", host: "huggingface", hfType, owner, name };
  }
  return null;
}

/** The repo's Shadowgraph page — visiting it adds a repo Shadowgraph doesn't have yet. */
export function shadowgraphRepoPath(page) {
  return page.host === "huggingface" ? `/hf/${page.hfType}s/${page.owner}/${page.name}` : `/${page.owner}/${page.name}`;
}

async function request(path, init = {}) {
  const base = await getBaseUrl();
  const response = await fetch(`${base}${path}`, {
    credentials: "include",
    ...init,
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, body };
}

export function fetchPage(page) {
  if (page.kind === "paper") {
    // The API takes an ACM paper as its full 10.1145 DOI, not the bare suffix.
    const id = page.source === "acm" ? `10.1145/${page.id}` : page.id;
    return request(`/api/extension/paper?${page.source}=${encodeURIComponent(id)}`);
  }
  const hf = page.host === "huggingface" ? `&hf=${page.hfType}` : "";
  return request(`/api/extension/repo?owner=${encodeURIComponent(page.owner)}&name=${encodeURIComponent(page.name)}${hf}`);
}

export function fetchFolders(repositoryId) {
  return request(`/api/extension/folders?repositoryId=${repositoryId}`);
}

export function saveBookmark(repositoryId, folderId) {
  return request("/api/extension/bookmarks", {
    method: "PUT",
    body: JSON.stringify({ repositoryId, folderId }),
  });
}

export function removeBookmark(repositoryId) {
  return request("/api/extension/bookmarks", {
    method: "DELETE",
    body: JSON.stringify({ repositoryId }),
  });
}

// Views of supported pages made while signed out, kept in the extension's own
// storage (it can't reach shadowgraph.io's localStorage from other sites) and
// uploaded to /api/extension/views once a request comes back signed in.
// Same item shape as the site's own localStorage queue (PendingView).
const PENDING_KEY = "pendingViews";
const MAX_PENDING = 100;

function viewKey(view) {
  return view.repositoryId != null ? `repo:${view.repositoryId}` : `paper:${view.paperSource}:${view.paperId}`;
}

const PAPER_URLS = {
  arxiv: (id) => `https://arxiv.org/abs/${id}`,
  acm: (id) => `https://dl.acm.org/doi/10.1145/${id}`,
};

/**
 * The view to remember for a page the API resolved, or null (a paper nobody
 * cites isn't tracked). `display` is what the panel's Recently viewed tab
 * shows for it while signed out; it stays local — uploadPendingViews sends
 * only the ids and time.
 */
export function viewFor(page, body) {
  if (page.kind === "repo") {
    const { id, fullName, url, avatarUrl, shadowgraphUrl } = body.repo;
    return { repositoryId: id, display: { fullName, url, avatarUrl, shadowgraphUrl } };
  }
  if (body.repos.length === 0) return null;
  const { source, id, title, shadowgraphUrl } = body.paper;
  return { paperSource: source, paperId: id, display: { title, url: PAPER_URLS[source](id), shadowgraphUrl } };
}

/** Views recorded while signed out, newest first (for the panel's Recently viewed tab). */
export async function readPendingViews() {
  const { [PENDING_KEY]: pending = [] } = await chrome.storage.local.get(PENDING_KEY);
  return pending;
}

export function fetchRecentlyViewed() {
  return request("/api/extension/recently-viewed");
}

export async function queuePendingView(view) {
  const entry = { ...view, viewedAt: Date.now() };
  const key = viewKey(entry);
  const { [PENDING_KEY]: pending = [] } = await chrome.storage.local.get(PENDING_KEY);
  const next = [entry, ...pending.filter((v) => viewKey(v) !== key)].slice(0, MAX_PENDING);
  await chrome.storage.local.set({ [PENDING_KEY]: next });
}

/** Uploads queued views; they stay queued (for the next attempt) unless the server accepts them. */
export async function uploadPendingViews() {
  const { [PENDING_KEY]: pending = [] } = await chrome.storage.local.get(PENDING_KEY);
  if (pending.length === 0) return;
  const views = pending.map(({ repositoryId, paperSource, paperId, viewedAt }) => ({ repositoryId, paperSource, paperId, viewedAt }));
  const { ok } = await request("/api/extension/views", { method: "POST", body: JSON.stringify({ views }) });
  if (!ok) return;
  // Keep anything re-queued while the upload was in flight.
  const sentAt = new Map(pending.map((v) => [viewKey(v), v.viewedAt]));
  const { [PENDING_KEY]: latest = [] } = await chrome.storage.local.get(PENDING_KEY);
  await chrome.storage.local.set({ [PENDING_KEY]: latest.filter((v) => (sentAt.get(viewKey(v)) ?? -1) < v.viewedAt) });
}
