# Shadowgraph Chrome extension

The side panel for [Shadowgraph](https://shadowgraph.io): open source repos citing the paper you're reading, and what people are saying about the repo you're looking at. Manifest V3, plain JS, no build step. Also on the [Chrome Web Store](https://shadowgraph.io/extension).

- **Papers** — arXiv (`/abs`, `/pdf`, `/html`, and huggingface.co/papers/{id}) and ACM (dl.acm.org DOI pages): repos citing the paper in their README, ordered by a blend of contributor PageRank and stars.
- **Repos** — GitHub and Hugging Face (models, datasets, spaces): project health (OpenSSF Scorecard, published package), significant stargazers, similar repos and HN/Reddit/X mentions. Public repos only — Shadowgraph never ingests a private repo, so the panel shows "Not on Shadowgraph yet" for one. For a public GitHub repo that isn't on Shadowgraph, a signed-in visitor gets an **Add to Shadowgraph** button.
- **Bookmarks**: save any listed repo to a Shadowgraph folder when signed in on the site. The extension reuses the site's session cookie (via its host permission), so there's no separate login.

The toolbar badge shows the count of citing repos (papers) or similar repos (repos).

## Load it

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → pick this directory.
2. It talks to https://shadowgraph.io. To point it at a local Shadowgraph server instead, open the extension's options and switch the server to `http://localhost:3000`.

The Chrome Web Store build is this directory without the options page and the localhost host permission.

## API

Served by shadowgraph.io:

| Route | |
|---|---|
| `GET /api/extension/paper?arxiv=<id or url>` or `?acm=<10.1145 DOI or url>` | citing repos + viewer bookmark state |
| `GET /api/extension/repo?owner=&name=[&hf=model\|dataset\|space]` | repo, similar repos, mentions, project health, significant stargazers + viewer bookmark state |
| `POST /api/extension/repo` `{owner, name}` | add a GitHub repo Shadowgraph doesn't have yet (signed in) |
| `GET /api/extension/folders?repositoryId=` | folder tree for the picker (signed in) |
| `PUT /api/extension/bookmarks` `{repositoryId, folderId?}` | save (root folder if no folderId) |
| `DELETE /api/extension/bookmarks` `{repositoryId}` | remove from all folders |
