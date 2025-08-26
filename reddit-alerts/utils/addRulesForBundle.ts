const WORKER_BASE_URL = "https://reddit-alerts-worker.reddit-alerts-worker.workers.dev";

export default async function addRulesForBundle(
  expoToken,
  bundle,
  keyword
) {
  const listRes = await fetch(`${WORKER_BASE_URL}/rules/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expo_push_token: expoToken }),
  });
  const listJson = await listRes.json();
  const existing = listJson.rules || [];
  const exists = new Set(existing.map(r => `${r.subreddit.toLowerCase()}::${r.keyword.toLowerCase()}`));
  const toAdd = bundle.subreddits.filter(
    sub => !exists.has(`${sub.toLowerCase()}::${keyword.toLowerCase()}`)
  );
  let added = 0;
  for (const subreddit of toAdd) {
    const res = await fetch(`${WORKER_BASE_URL}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subreddit, keyword, expo_push_token: expoToken }),
    });
    if (res.ok) added += 1;
    await new Promise(r => setTimeout(r, 50));
  }
  const skipped = bundle.subreddits.length - added;
  return { added, skipped };
}
