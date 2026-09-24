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
