# Shadowgraph Chrome extension

Manifest V3, plain JS, no build step.

- **arXiv paper** (`/abs`, `/pdf`, `/html`): repos citing the paper in their README, ordered by contributor PageRank.
- **GitHub repo**: similar repos and HN/Reddit/X mentions.
- **Bookmarks**: save any listed repo to a Shadowgraph folder when signed in on the site. The extension reuses the site's session cookie (via its host permission), so there's no separate login.

The toolbar badge shows the count of citing repos (arXiv) or similar repos (GitHub).

## Load it

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → pick this `extension/` directory.
2. For local dev, open the extension's options and switch the server to `http://localhost:3000`.

## API

Served by the Next app under `src/app/api/extension/`:

| Route | |
|---|---|
| `GET /api/extension/paper?arxiv=<id or url>` | citing repos + viewer bookmark state |
| `GET /api/extension/repo?owner=&name=` | repo, similar repos, mentions + viewer bookmark state |
| `GET /api/extension/folders?repositoryId=` | folder tree for the picker (signed in) |
| `PUT /api/extension/bookmarks` `{repositoryId, folderId?}` | save (root folder if no folderId) |
| `DELETE /api/extension/bookmarks` `{repositoryId}` | remove from all folders |
