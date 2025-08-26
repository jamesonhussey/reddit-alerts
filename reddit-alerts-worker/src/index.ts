// src/index.ts

import { Env, Rule, AlertItem } from "./types";
import { getAppAccessToken, fetchNewPosts } from "./reddit";
import { sendExpoPush } from "./notifications";
import { handleAddRule, handleListRules, handleDeleteRule, loadIndex, saveIndex, addToIndex, removeFromIndex } from "./rules";
import { withCORS, json, readJson } from "./utils";

async function handleListAlerts(req: Request, env: Env) {
  const body = await readJson<any>(req);
  const expo_push_token = body?.expo_push_token;
  let limit = Number(body?.limit ?? 100);
  if (!Number.isFinite(limit)) limit = 100;
  limit = Math.max(1, Math.min(300, Math.floor(limit)));

  if (!expo_push_token) return json({ error: "Missing expo_push_token" }, { status: 400 });

  const akey = `alerts:${expo_push_token}`;
  const alerts: AlertItem[] = JSON.parse((await env.KV.get(akey)) || "[]");
  alerts.sort((a, b) => (b.postedTs ?? b.ts ?? 0) - (a.postedTs ?? a.ts ?? 0));
  return json({ alerts: alerts.slice(0, limit) });
}

async function handleRoutes(req: Request, env: Env) {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return withCORS({ status: 204 });

  if (req.method === "POST" && url.pathname === "/rules") {
    return handleAddRule(req, env);
  }
  if (req.method === "GET" && url.pathname === "/") {
    return json({ ok: true, mode: "app-only-oauth" });
  }
  if (req.method === "POST" && url.pathname === "/rules/list") {
    return handleListRules(req, env);
  }
  if (req.method === "POST" && url.pathname === "/rules/delete") {
    return handleDeleteRule(req, env);
  }
  if (req.method === "POST" && url.pathname === "/alerts/list") {
    return handleListAlerts(req, env);
  }

  return json({ error: "Not found" }, { status: 404 });
}

async function runCron(env: Env) {
  let appToken: string;
  console.log(
    "Using client_id:",
    env.REDDIT_CLIENT_ID?.slice(0, 4) + "...",
    "secret set:",
    !!env.REDDIT_CLIENT_SECRET
  );
  try {
    appToken = await getAppAccessToken(env.REDDIT_CLIENT_ID, env.REDDIT_CLIENT_SECRET);
  } catch {
    console.log("Failed to get app token");
    return;
  }
  const tokenSet = await loadIndex(env);
  const tokens = Array.from(tokenSet);
  console.log(`Cron start: index has ${tokens.length} token(s)`);
  for (const expoToken of tokens) {
    const rulesKey = `rules:${expoToken}`;
    const rulesStr = await env.KV.get(rulesKey);
    if (!rulesStr || rulesStr === "[]") {
      console.log(`Pruning empty/missing rules key: ${rulesKey}`);
      await env.KV.delete(rulesKey);
      await env.KV.delete(`alerts:${expoToken}`);
      await removeFromIndex(env, expoToken);
      continue;
    }
    const rules: Rule[] = JSON.parse(rulesStr) as Rule[];
    if (!rules.length) {
      console.log(`Pruning empty parsed rules for: ${rulesKey}`);
      await env.KV.delete(rulesKey);
      await env.KV.delete(`alerts:${expoToken}`);
      await removeFromIndex(env, expoToken);
      continue;
    }
    const alertsKey = `alerts:${expoToken}`;
    let alertBuf = JSON.parse((await env.KV.get(alertsKey)) || "[]") as any[];
    const existing = new Set<string>(
      alertBuf.map((a: { id: string; subreddit: string }) => `${a?.id ?? ""}-${a?.subreddit ?? ""}`)
    );
    let changed = false;
    for (const rule of rules) {
      try {
        const posts = await fetchNewPosts(rule.subreddit, appToken, env.REDDIT_USER_AGENT);
        const firstRun = !rule.lastSeenFullname;
        const lastIdx = rule.lastSeenFullname
          ? posts.findIndex((p: any) => p?.name === rule.lastSeenFullname)
          : -1;
        const fresh = lastIdx >= 0 ? posts.slice(0, lastIdx) : posts;
        if (posts[0]?.name && posts[0].name !== rule.lastSeenFullname) {
          rule.lastSeenFullname = posts[0].name;
          changed = true;
        }
        const source = firstRun ? posts : fresh;
        const kw = (rule.keyword || "").toLowerCase();
        const matches = source.filter((p: any) => {
          const hay = `${p?.title ?? ""}\n${p?.selftext ?? ""}`.toLowerCase();
          return kw && hay.includes(kw);
        });
        if (matches.length > 0) {
          const seenThisRun = new Set<string>();
          for (const post of matches) {
            const fullname: string = post?.name ?? "";
            const postTitle: string = post?.title ?? "(No title)";
            const postUrl: string =
              (post?.permalink ? `https://reddit.com${post.permalink}` : "") ||
              (post?.url ?? "");
            const combinedKey = `${fullname}-${rule.subreddit}`;
            if (existing.has(combinedKey) || (fullname && seenThisRun.has(combinedKey))) continue;
            if (fullname) seenThisRun.add(combinedKey);
            existing.add(combinedKey);
            if (!firstRun) {
              await sendExpoPush(expoToken, `Match found in r/${rule.subreddit}`, postTitle);
            }
            console.log(
              `→ Post matched:\n` +
                `   - id: ${fullname}\n` +
                `   - title: ${postTitle}\n` +
                `   - url: ${postUrl}`
            );
            const postedTs =
              typeof post?.created_utc === "number" ? Math.round(post.created_utc * 1000) : Date.now();
            alertBuf.unshift({
              id: fullname || Math.random().toString(36).slice(2),
              subreddit: rule.subreddit,
              title: postTitle,
              url: postUrl,
              ts: Date.now(),
              postedTs,
            });
          }
        }
      } catch {
        // ignore
      }
    }
    if (alertBuf.length > 200) alertBuf = alertBuf.slice(0, 200);
    await env.KV.put(alertsKey, JSON.stringify(alertBuf));
    if (changed) {
      await env.KV.put(rulesKey, JSON.stringify(rules));
    }
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await handleRoutes(req, env);
    } catch (err: any) {
      return json({ error: err?.message ?? "Unhandled error" }, { status: 500 });
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    try {
      await runCron(env);
    } catch {
      // ignore errors -> cron runs again
    }
  },
}