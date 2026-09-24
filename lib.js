// Shared by background.js, popup.js and options.js.

export const DEFAULT_BASE_URL = "https://shadowgraph.io";

export async function getBaseUrl() {
  const { baseUrl } = await chrome.storage.sync.get("baseUrl");
  return (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

const ARXIV_HOSTS = new Set(["arxiv.org", "www.arxiv.org"]);
const ARXIV_PATH = /^\/(?:abs|pdf|html|format)\/(.+?)(?:\.pdf)?\/?$/;
const NEW_STYLE_ID = /^(\d{4}\.\d{4,5})(?:v\d+)?$/;
const OLD_STYLE_ID = /^([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i;

// First path segments on github.com that aren't a user or org.
const GITHUB_RESERVED = new Set([
  "about", "account", "apps", "codespaces", "collections", "customer-stories", "dashboard",
  "enterprise", "explore", "features", "issues", "login", "marketplace", "new", "notifications",
  "orgs", "organizations", "pricing", "pulls", "readme", "search", "security", "settings",
  "signup", "sponsors", "topics", "trending", "users",
]);
const GITHUB_OWNER = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/;
const GITHUB_REPO = /^[\w.-]{1,100}$/;

/** What the page at `url` is, from Shadowgraph's point of view: an arXiv paper, a GitHub repo, or neither. */
export function detectPage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (ARXIV_HOSTS.has(parsed.hostname)) {
    const match = parsed.pathname.match(ARXIV_PATH);
    const raw = match?.[1];
    const id = raw?.match(NEW_STYLE_ID)?.[1] ?? raw?.match(OLD_STYLE_ID)?.[1];
    return id ? { kind: "arxiv", id } : null;
  }
  if (parsed.hostname === "github.com") {
    const [owner, name] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !name || GITHUB_RESERVED.has(owner.toLowerCase())) return null;
    const repo = name.replace(/\.git$/, "");
    if (!GITHUB_OWNER.test(owner) || !GITHUB_REPO.test(repo)) return null;
    return { kind: "github", owner, name: repo };
  }
  return null;
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
  if (page.kind === "arxiv") {
    return request(`/api/extension/paper?arxiv=${encodeURIComponent(page.id)}`);
  }
  return request(`/api/extension/repo?owner=${encodeURIComponent(page.owner)}&name=${encodeURIComponent(page.name)}`);
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
