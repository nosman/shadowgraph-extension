# Shadowgraph Chrome extension

Manifest V3, plain JS, no build step.

- **Papers** — arXiv (`/abs`, `/pdf`, `/html`, and huggingface.co/papers/{id}) and ACM (dl.acm.org DOI pages): repos citing the paper in their README, ordered by a blend of contributor PageRank and stars.
- **Repos** — GitHub and Hugging Face (models, datasets, spaces): similar repos and HN/Reddit/X mentions. Public repos only — Shadowgraph never ingests a private repo (see `PrivateRepoError` in `src/lib/github.ts`), so the panel shows "Not on Shadowgraph yet" for one.
- **Bookmarks**: save any listed repo to a Shadowgraph folder when signed in on the site. The extension reuses the site's session cookie (via its host permission), so there's no separate login.

The toolbar badge shows the count of citing repos (papers) or similar repos (repos).

## Load it

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → pick this `extension/` directory.
2. For local dev, open the extension's options and switch the server to `http://localhost:3000`.

## Publishing

`./scripts/package-extension.sh` builds the Chrome Web Store zip into `dist/`, without the localhost permission and options page used for development. Listing text, screenshots and dashboard answers are in `chrome-web-store/LISTING.md`.

## API

Served by the Next app under `src/app/api/extension/`:

| Route | |
|---|---|
| `GET /api/extension/paper?arxiv=<id or url>` or `?acm=<10.1145 DOI or url>` | citing repos + viewer bookmark state |
| `GET /api/extension/repo?owner=&name=[&hf=model\|dataset\|space]` | repo, similar repos, mentions + viewer bookmark state |
| `GET /api/extension/folders?repositoryId=` | folder tree for the picker (signed in) |
| `PUT /api/extension/bookmarks` `{repositoryId, folderId?}` | save (root folder if no folderId) |
| `DELETE /api/extension/bookmarks` `{repositoryId}` | remove from all folders |
