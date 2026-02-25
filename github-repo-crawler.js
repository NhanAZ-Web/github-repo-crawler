    (function () {
      const tokenInput = document.getElementById("token");
      const usernameInput = document.getElementById("username");
      const fetchBtn = document.getElementById("fetchBtn");
      const statusEl = document.getElementById("status");
      const warningEl = document.getElementById("warning");
      const btnText = document.getElementById("btnText");
      const btnSpinner = document.getElementById("btnSpinner");

      let isRunning = false;

      function setRunning(running) {
        isRunning = running;
        fetchBtn.disabled = running;
        btnSpinner.style.display = running ? "inline-block" : "none";
        btnText.textContent = running ? "Processing..." : "Fetch & Export CSV";
      }

      function setStatus(message, strong) {
        statusEl.textContent = message || "";
        if (strong) {
          statusEl.classList.add("status-strong");
        } else {
          statusEl.classList.remove("status-strong");
        }
      }

      function setWarning(message) {
        warningEl.textContent = message || "";
      }

      function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function buildHeaders(token) {
        const headers = {
          "Accept": "application/vnd.github+json"
        };
        if (token) {
          headers["Authorization"] = "Bearer " + token.trim();
        }
        return headers;
      }

      async function fetchWithAuth(url, token, options = {}) {
        const headers = buildHeaders(token);
        const merged = Object.assign({}, options, { headers: Object.assign({}, headers, options.headers || {}) });
        return fetch(url, merged);
      }

      function parseLinkHeader(header) {
        if (!header) return {};
        const parts = header.split(",");
        const links = {};
        for (const part of parts) {
          const section = part.split(";");
          if (section.length !== 2) continue;
          const url = section[0].trim().replace(/^<|>$/g, "");
          const relMatch = section[1].trim().match(/rel="(.*)"/);
          if (relMatch) {
            links[relMatch[1]] = url;
          }
        }
        return links;
      }

      function getLastPageFromLink(linkHeader) {
        const links = parseLinkHeader(linkHeader);
        const lastUrl = links["last"];
        if (!lastUrl) return null;
        try {
          const urlObj = new URL(lastUrl);
          const page = urlObj.searchParams.get("page");
          return page ? parseInt(page, 10) : null;
        } catch (e) {
          return null;
        }
      }

      async function getTotalCountFromListEndpoint(baseUrlWithParams, token) {
        try {
          const url = baseUrlWithParams.includes("per_page=")
            ? baseUrlWithParams
            : (baseUrlWithParams + (baseUrlWithParams.includes("?") ? "&" : "?") + "per_page=1");
          const res = await fetchWithAuth(url, token);
          if (!res.ok) {
            return "N/A";
          }
          const totalHeader = res.headers.get("X-Total-Count") || res.headers.get("x-total-count");
          if (totalHeader) {
            const v = parseInt(totalHeader, 10);
            return Number.isFinite(v) ? v : "N/A";
          }
          const link = res.headers.get("Link") || res.headers.get("link");
          const data = await res.json().catch(() => null);
          if (link) {
            const lastPage = getLastPageFromLink(link);
            if (lastPage != null) {
              // Với per_page=1: tổng = số trang
              return lastPage;
            }
          }
          if (Array.isArray(data)) {
            return data.length;
          }
          return 0;
        } catch (e) {
          return "N/A";
        }
      }

      async function getLanguagesBreakdown(owner, repo, token) {
        const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`;
        try {
          const res = await fetchWithAuth(url, token);
          if (!res.ok) {
            return "N/A";
          }
          const data = await res.json();
          const entries = Object.entries(data || {});
          if (entries.length === 0) return "";
          return entries.map(([lang, bytes]) => `${lang}:${bytes}`).join(";");
        } catch (e) {
          return "N/A";
        }
      }

      async function getLatestReleaseTag(owner, repo, token) {
        const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`;
        try {
          const res = await fetchWithAuth(url, token);
          if (res.status === 404) {
            return "";
          }
          if (!res.ok) {
            return "N/A";
          }
          const data = await res.json();
          return data.tag_name || data.name || "";
        } catch (e) {
          return "N/A";
        }
      }

      async function getReadmeExists(owner, repo, token) {
        const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;
        try {
          const res = await fetchWithAuth(url, token);
          if (res.status === 404) return false;
          if (!res.ok) return "N/A";
          return true;
        } catch (e) {
          return "N/A";
        }
      }

      async function getRateLimit(token) {
        try {
          const res = await fetchWithAuth("https://api.github.com/rate_limit", token);
          if (!res.ok) return null;
          const data = await res.json();
          return data && data.rate ? data.rate : null;
        } catch (e) {
          return null;
        }
      }

      async function checkAndMaybeWaitRateLimit(token) {
        const info = await getRateLimit(token);
        if (!info) return;
        const remaining = info.remaining;
        const reset = info.reset ? info.reset * 1000 : null;

        if (remaining < 20 && reset) {
          const now = Date.now();
          const waitMs = reset - now;
          if (waitMs > 0) {
            let secsLeft = Math.ceil(waitMs / 1000);
            while (secsLeft > 0 && isRunning) {
              const mins = Math.floor(secsLeft / 60);
              const secs = secsLeft % 60;
              setStatus(`Rate limit almost exhausted. Pausing until reset in ${mins}m ${secs}s...`, true);
              await new Promise((resolve) => setTimeout(resolve, 1000));
              secsLeft--;
            }
          }
        }
      }

      async function fetchAllReposForUserOrOrg(name, token) {
        const baseUser = `https://api.github.com/users/${encodeURIComponent(name)}/repos?per_page=100&type=public&sort=full_name`;
        const baseOrg = `https://api.github.com/orgs/${encodeURIComponent(name)}/repos?per_page=100&type=public&sort=full_name`;

        async function fetchPaginated(startUrl, label) {
          let url = startUrl;
          let all = [];
          let page = 1;
          while (url && isRunning) {
            setStatus(`Fetching repository list (${label}) - page ${page}... Total so far: ${all.length}`, false);
            const res = await fetchWithAuth(url, token);
            if (!res.ok) {
              return { ok: false, status: res.status, json: await res.json().catch(() => null) };
            }
            const data = await res.json();
            all = all.concat(data);
            const link = res.headers.get("Link") || res.headers.get("link");
            const links = parseLinkHeader(link);
            url = links["next"] || null;
            page++;
          }
          return { ok: true, repos: all };
        }

        let result = await fetchPaginated(baseUser, "user");
        if (!result.ok && (result.status === 404 || result.status === 403)) {
          result = await fetchPaginated(baseOrg, "organization");
        }

        if (!result.ok) {
          const code = result.status;
          throw new Error(`Unable to fetch repository list (HTTP ${code || "N/A"}). Please verify the username/org or your token.`);
        }

        return result.repos || [];
      }

      function csvEscape(value) {
        if (value === null || value === undefined) return '""';
        const str = String(value);
        const escaped = str.replace(/"/g, '""');
        return `"${escaped}"`;
      }

      function buildCsv(reposData) {
        const headers = [
          "name",
          "full_name",
          "description",
          "html_url",
          "homepage",
          "created_at",
          "updated_at",
          "pushed_at",
          "stargazers_count",
          "watchers_count",
          "forks_count",
          "open_issues_count",
          "open_prs",
          "closed_prs",
          "contributors_count",
          "commit_count",
          "releases_count",
          "latest_release",
          "size_kb",
          "language",
          "languages_breakdown",
          "topics",
          "license",
          "readme_exists",
          "is_fork",
          "is_archived",
          "is_template",
          "default_branch",
          "visibility"
        ];

        const lines = [];
        lines.push(headers.join(","));

        for (const r of reposData) {
          const row = [
            csvEscape(r.name),
            csvEscape(r.full_name),
            csvEscape(r.description),
            csvEscape(r.html_url),
            csvEscape(r.homepage),
            csvEscape(r.created_at),
            csvEscape(r.updated_at),
            csvEscape(r.pushed_at),
            csvEscape(r.stargazers_count),
            csvEscape(r.watchers_count),
            csvEscape(r.forks_count),
            csvEscape(r.open_issues_count),
            csvEscape(r.open_prs),
            csvEscape(r.closed_prs),
            csvEscape(r.contributors_count),
            csvEscape(r.commit_count),
            csvEscape(r.releases_count),
            csvEscape(r.latest_release),
            csvEscape(r.size_kb),
            csvEscape(r.language),
            csvEscape(r.languages_breakdown),
            csvEscape(r.topics),
            csvEscape(r.license),
            csvEscape(r.readme_exists),
            csvEscape(r.is_fork),
            csvEscape(r.is_archived),
            csvEscape(r.is_template),
            csvEscape(r.default_branch),
            csvEscape(r.visibility)
          ];
          lines.push(row.join(","));
        }

        return lines.join("\r\n");
      }

      function triggerDownloadCsv(username, csvContent) {
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);

        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, "0");
        const dd = String(today.getDate()).padStart(2, "0");

        const safeName = username.replace(/[^a-zA-Z0-9_-]+/g, "_");
        const filename = `${safeName || "github"}_github_repos_${yyyy}-${mm}-${dd}.csv`;

        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      async function processRepos(repos, token) {
        const total = repos.length;
        const results = [];
        let processed = 0;
        let errorsCount = 0;

        const owner = repos[0] && repos[0].owner && repos[0].owner.login
          ? repos[0].owner.login
          : null;

        async function processSingle(repo, indexDisplay) {
          const ownerLogin = repo.owner && repo.owner.login ? repo.owner.login : owner || "";
          const repoName = repo.name || "";
          setStatus(`Processing repo ${indexDisplay}/${total}: ${repoName}... (${results.length} completed)`, false);

          let commitCount = "N/A";
          let openPrs = "N/A";
          let closedPrs = "N/A";
          let contributorsCount = "N/A";
          let releasesCount = "N/A";
          let languagesBreakdown = "N/A";
          let latestRelease = "N/A";
          let readmeExists = "N/A";

          try {
            const base = `https://api.github.com/repos/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repoName)}`;
            [
              commitCount,
              openPrs,
              closedPrs,
              contributorsCount,
              releasesCount,
              languagesBreakdown,
              latestRelease,
              readmeExists
            ] = await Promise.all([
              getTotalCountFromListEndpoint(`${base}/commits?per_page=1`, token),
              getTotalCountFromListEndpoint(`${base}/pulls?state=open&per_page=1`, token),
              getTotalCountFromListEndpoint(`${base}/pulls?state=closed&per_page=1`, token),
              getTotalCountFromListEndpoint(`${base}/contributors?per_page=1&anon=true`, token),
              getTotalCountFromListEndpoint(`${base}/releases?per_page=1`, token),
              getLanguagesBreakdown(ownerLogin, repoName, token),
              getLatestReleaseTag(ownerLogin, repoName, token),
              getReadmeExists(ownerLogin, repoName, token)
            ]);
          } catch (e) {
            errorsCount++;
          }

          let openIssuesWithoutPrs = "N/A";
          if (typeof repo.open_issues_count === "number" && typeof openPrs === "number") {
            openIssuesWithoutPrs = repo.open_issues_count - openPrs;
            if (!Number.isFinite(openIssuesWithoutPrs)) {
              openIssuesWithoutPrs = "N/A";
            }
          }

          const topicsJoined = Array.isArray(repo.topics) ? repo.topics.join(";") : "";
          const licenseName = repo.license && repo.license.name ? repo.license.name : "";

          results.push({
            name: repo.name || "",
            full_name: repo.full_name || "",
            description: repo.description || "",
            html_url: repo.html_url || "",
            homepage: repo.homepage || "",
            created_at: repo.created_at || "",
            updated_at: repo.updated_at || "",
            pushed_at: repo.pushed_at || "",
            stargazers_count: repo.stargazers_count != null ? repo.stargazers_count : "",
            watchers_count: repo.watchers_count != null ? repo.watchers_count : "",
            forks_count: repo.forks_count != null ? repo.forks_count : "",
            open_issues_count: openIssuesWithoutPrs,
            open_prs: openPrs,
            closed_prs: closedPrs,
            contributors_count: contributorsCount,
            commit_count: commitCount,
            releases_count: releasesCount,
            latest_release: latestRelease,
            size_kb: repo.size != null ? repo.size : "",
            language: repo.language || "",
            languages_breakdown: languagesBreakdown,
            topics: topicsJoined,
            license: licenseName,
            readme_exists: readmeExists,
            is_fork: repo.fork === true,
            is_archived: repo.archived === true,
            is_template: repo.is_template === true,
            default_branch: repo.default_branch || "",
            visibility: repo.visibility || ""
          });

          processed++;
        }

        const concurrency = 5;
        for (let i = 0; i < repos.length; i += concurrency) {
          if (!isRunning) break;
          const batch = repos.slice(i, i + concurrency);
          const batchStartIndex = i;

          await Promise.all(
            batch.map((repo, idx) =>
              processSingle(repo, batchStartIndex + idx + 1).catch(() => {
                errorsCount++;
              })
            )
          );

          if (processed % 10 === 0) {
            await checkAndMaybeWaitRateLimit(token);
          }
        }

        return { results, errorsCount };
      }

      async function handleFetchClick() {
        if (isRunning) return;

        const token = tokenInput.value.trim();
        const username = usernameInput.value.trim();

        if (!username) {
          setWarning("Please enter a GitHub username or organization.");
          setStatus("", false);
          return;
        }

        setWarning("");
        if (!token) {
          setWarning("No token provided: you are limited to 60 unauthenticated requests per hour. Consider using a token to avoid hitting the limit.");
        }

        setRunning(true);
        setStatus("Starting repository fetch...", true);

        let totalErrors = 0;

        try {
          const repos = await fetchAllReposForUserOrOrg(username, token);
          if (!repos || repos.length === 0) {
            setStatus("No public repositories found for this user/organization.", true);
            setRunning(false);
            return;
          }

          setStatus(`Found ${repos.length} repositories. Fetching detailed data...`, true);

          const { results, errorsCount } = await processRepos(repos, token);
          totalErrors += errorsCount;

          const csv = buildCsv(results);
          triggerDownloadCsv(username, csv);

          setStatus(`Done! Exported ${results.length} repositories. Errors encountered: ${totalErrors}.`, true);
        } catch (e) {
          console.error(e);
          setStatus(`An error occurred: ${e.message || e.toString()}`, true);
        } finally {
          setRunning(false);
        }
      }

      fetchBtn.addEventListener("click", () => {
        handleFetchClick();
      });

      usernameInput.addEventListener("keyup", (e) => {
        if (e.key === "Enter") {
          handleFetchClick();
        }
      });

      tokenInput.addEventListener("keyup", (e) => {
        if (e.key === "Enter") {
          handleFetchClick();
        }
      });
    })();
