import { detectPage, fetchPage } from "./lib.js";

// Badge on the toolbar icon: how many repos cite the arXiv paper, or how
// many similar repos Shadowgraph has for the GitHub repo, in the current tab.

async function updateBadge(tabId, url) {
  const page = detectPage(url);
  if (!page) {
    await chrome.action.setBadgeText({ tabId, text: "" });
    return;
  }
  try {
    const { ok, body } = await fetchPage(page);
    const count = !ok ? 0 : page.kind === "arxiv" ? body.repos.length : body.similar.length;
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2f9e44" });
    await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(Math.min(count, 99)) : "" });
  } catch {
    await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }
}

// changeInfo.url also fires for GitHub's client-side navigations, not just full page loads.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) updateBadge(tabId, changeInfo.url);
  else if (changeInfo.status === "complete" && tab.url) updateBadge(tabId, tab.url);
});
