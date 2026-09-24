import { detectPage, fetchPage, getBaseUrl, isSupportedSite, queuePendingView, uploadPendingViews, viewFor } from "./lib.js";

// The toolbar icon opens the side panel (sidepanel.html) rather than a popup.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// The panel and toolbar icon are off by default and only switched on per
// tab while that tab is on a supported site (see isSupportedSite) — Chrome
// closes the panel when you switch to or navigate a tab to anywhere else.
// Per-tab settings override these global defaults.
chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
chrome.action.disable().catch(() => {});

async function syncPanel(tabId, url) {
  const enabled = isSupportedSite(url);
  await chrome.sidePanel.setOptions({ tabId, enabled, ...(enabled ? { path: "sidepanel.html" } : {}) }).catch(() => {});
  await (enabled ? chrome.action.enable(tabId) : chrome.action.disable(tabId)).catch(() => {});
}

// Tabs already open when the extension loads (install, update, browser start).
chrome.tabs.query({}).then((tabs) => {
  for (const tab of tabs) syncPanel(tab.id, tab.url);
});

// A signed-in response has already recorded the view server-side, and means
// anything queued while signed out can be uploaded now.
async function trackView(page, body) {
  if (body.viewer.signedIn) {
    await uploadPendingViews().catch(() => {});
  } else {
    const view = viewFor(page, body);
    if (view) await queuePendingView(view);
  }
}

// A shadowgraph.io page finishing loading is usually the moment right after
// signing in — upload then, rather than waiting for the next supported page.
async function uploadIfOnShadowgraph(url) {
  try {
    if (new URL(url).origin === new URL(await getBaseUrl()).origin) await uploadPendingViews();
  } catch {
    // Not signed in yet (401) or offline — stays queued.
  }
}

// Badge on the toolbar icon: how many repos cite the paper, or how many
// HN/Reddit/X mentions the repo has, in the current tab.
async function updateBadge(tabId, url) {
  const page = detectPage(url);
  if (!page) {
    await chrome.action.setBadgeText({ tabId, text: "" });
    return;
  }
  try {
    const { ok, body } = await fetchPage(page);
    if (ok) await trackView(page, body);
    const count = !ok ? 0 : page.kind === "paper" ? body.repos.length : body.mentions.length;
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2f9e44" });
    await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(Math.min(count, 99)) : "" });
  } catch {
    await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }
}

// changeInfo.url also fires for GitHub's and Hugging Face's client-side navigations, not just full page loads.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "loading") syncPanel(tabId, tab.url);
  if (changeInfo.url) updateBadge(tabId, changeInfo.url);
  else if (changeInfo.status === "complete" && tab.url) updateBadge(tabId, tab.url);
  if (changeInfo.status === "complete" && tab.url) uploadIfOnShadowgraph(tab.url);
});
