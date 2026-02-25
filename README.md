## GitHub Repo Crawler (CSV Export)

Tool for exporting all public repositories of a GitHub user or organization to CSV, running entirely in your browser.

### What this does

- Fetches all **public repositories** of a given user or organization via the GitHub REST API v3.
- Collects repository metadata (stars, forks, issues, pull requests, contributors, releases, languages, etc.).
- Generates and automatically downloads a CSV file with one row per repository.

### Files

- `index.html` – main entry point (for GitHub Pages and local use).
- `github-repo-crawler.js` – client‑side logic and GitHub API calls.

### How to use

1. Open `index.html` directly in a modern browser (double‑click or drag into the browser; no server required).
2. (Recommended) Paste a **GitHub Personal Access Token** in the token field.  
   - Without a token, the GitHub API limits you to **60 unauthenticated requests per hour**.
3. Enter the **GitHub username or organization name** you want to analyze.
4. Click **“Fetch & Export CSV”**.
5. Wait while progress messages appear below the button. When finished, a CSV file named like  
   `USERNAME_github_repos_YYYY-MM-DD.csv` will be downloaded automatically.

### Deploying on GitHub Pages

1. Create a new GitHub repository and add `index.html`, `github-repo-crawler.js`, and this `README.md`.
2. Push to the `main` (or `master`) branch.
3. In the repository, go to **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**, select your branch and the root folder (`/`), then save.
5. After a short delay, GitHub will expose a public URL for the site.

### Notes

- All work happens in the browser; data is only sent to `api.github.com`.
- The tool respects GitHub rate limits and may pause briefly when close to the limit.
- Only **public** repositories are included.

