/**
 * Marks a PR comment as owned by this tool, so a re-run on the same PR (e.g. a follow-up push)
 * updates the existing comment instead of piling up a new one every time.
 */
const MARKER = "<!-- jobtracker-ai-code-review -->";

interface Comment {
  id: number;
  body: string;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

async function githubRequest(url: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, headers: authHeaders(token) });
  if (!res.ok) {
    throw new Error(`GitHub API ${init?.method ?? "GET"} ${url} failed: ${res.status} ${await res.text()}`);
  }
  return res;
}

async function findExistingComment(repo: string, prNumber: number, token: string): Promise<Comment | null> {
  const res = await githubRequest(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`, token);
  const comments = (await res.json()) as Comment[];
  return comments.find((comment) => comment.body.startsWith(MARKER)) ?? null;
}

/**
 * Creates a review comment on the PR, or updates the one this tool previously posted on the
 * same PR if it finds one.
 */
export async function upsertPrComment(repo: string, prNumber: number, token: string, body: string): Promise<void> {
  const markedBody = `${MARKER}\n${body}`;
  const existing = await findExistingComment(repo, prNumber, token);

  if (existing) {
    await githubRequest(`https://api.github.com/repos/${repo}/issues/comments/${existing.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ body: markedBody }),
    });
  } else {
    await githubRequest(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, token, {
      method: "POST",
      body: JSON.stringify({ body: markedBody }),
    });
  }
}
