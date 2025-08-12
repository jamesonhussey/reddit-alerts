// src/index.ts

export interface Env {
  KV: KVNamespace;
  REDDIT_USER_AGENT: string;
  REDDIT_CLIENT_ID: string;
  REDDIT_CLIENT_SECRET: string; // set via wrangler secret
}

type Rule = {
  subreddit: string;
  keyword: string;
  lastSeenFullname?: string | null;
};

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
};

function withCORS(init: ResponseInit = {}, body?: BodyInit | null) {
  const headers = new Headers(init.headers || {});
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  return new Response(body ?? null, { ...init, headers });
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers || {});
  for (const [k, v] of Object.entries(JSON_HEADERS)) headers.set(k, v);
  return withCORS({ ...init, headers }, JSON.stringify(data));
}

async function readJson<T = any>(req: Request): Promise<T> {
  try {
    return await req.json();
  } catch {
    throw new Error("Invalid JSON");
  }
}

// --- App-only OAuth (no user login) ---
async function getAppAccessToken(client_id: string, client_secret: string): Promise<string> {
  if (!client_id || !client_secret) {
    console.log("Missing Reddit credentials: ", {
      hasClientId: !!client_id,
      hasClientSecret: !!client_secret,
    });
    throw new Error("Missing Reddit credentials");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "read", // optional but harmless; some setups expect a scope
  });

  const resp = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${client_id}:${client_secret}`),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "reddit-alerts/0.1 by KodoMauve",
    },
    body,
  });

  const txt = await resp.text(); // read as text so we can log it raw
  if (!resp.ok) {
    console.log("Token exchange failed:", resp.status, txt);
    throw new Error(`App token failed: ${resp.status}`);
  }

  let j: any;
  try {
    j = JSON.parse(txt);
  } catch {
    console.log("Non-JSON token response:", txt);
    throw new Error("Non-JSON token response");
  }
  if (!j.access_token) {
    console.log("No access_token in response:", j);
    throw new Error("No access_token in response");
  }
  return j.access_token as string;
}

async function fetchNewPosts(subreddit: string, accessToken: string, userAgent: string) {
  const url = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/new?limit=50`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": userAgent || "reddit-alerts/0.1",
    },
  });
  if (!resp.ok) throw new Error(`Reddit ${resp.status} for r/${subreddit}`);
  const data = await resp.json<any>();
  const items = (data?.data?.children ?? []).map((c: any) => c?.data).filter(Boolean);
  return items;
}

async function sendExpoPush(expoToken: string, title: string, body: string) {
  // Actual push (keep commented out in "log-only" mode)
  // await fetch("https://exp.host/--/api/v2/push/send", {
  //   method: "POST",
  //   headers: JSON_HEADERS,
  //   body: JSON.stringify({ to: expoToken, title, body, sound: null, priority: "default" }),
  // });

  // Log-only testing
  console.log(`Would send push to ${expoToken}: ${title}`);
}

// ---------- Routes ----------
async function handleAddRule(req: Request, env: Env) {
  const { subreddit, keyword, expo_push_token } = await readJson(req);
  if (!subreddit || !keyword || !expo_push_token) {
    return json({ error: "Missing subreddit, keyword, or expo_push_token" }, { status: 400 });
  }

  const key = `rules:${expo_push_token}`;
  const rules: Rule[] = JSON.parse((await env.KV.get(key)) || "[]");
  rules.push({ subreddit, keyword, lastSeenFullname: null });
  await env.KV.put(key, JSON.stringify(rules));

  console.log("Saved rule:", { key, count: rules.length });

  return json({ ok: true });
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

  return json({ error: "Not found" }, { status: 404 });
}

// ---------- Cron (with generic KV list types) ----------
type KVListPage = KVNamespaceListResult<unknown, string>;
type IncompletePage = Extract<KVListPage, { list_complete: false }>;
function isIncomplete(page: KVListPage): page is IncompletePage {
  return (page as any).list_complete === false;
}

async function runCron(env: Env) {
  // One app token per tick
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
    return; // no token, nothing to do
  }

  // Log how many rule keys exist so we know the worker sees them
  const firstPage = await env.KV.list<unknown>({ prefix: "rules:" });
  const totalRulesKeys = firstPage.keys.length;
  console.log(`Cron start: found ${totalRulesKeys} rule key(s)`);

  let cursor: string | undefined = undefined;

  while (true) {
    const page: KVListPage = await env.KV.list<unknown>({ prefix: "rules:", cursor });

    for (const entry of page.keys) {
      const expoToken = entry.name.slice("rules:".length);
      const rulesStr = await env.KV.get(entry.name);
      if (!rulesStr) continue;
      const rules: Rule[] = JSON.parse(rulesStr);

      for (const rule of rules) {
        try {
          const posts = await fetchNewPosts(rule.subreddit, appToken, env.REDDIT_USER_AGENT);
          const lastIdx = rule.lastSeenFullname
            ? posts.findIndex((p: any) => p?.name === rule.lastSeenFullname)
            : -1;

          const fresh = lastIdx >= 0 ? posts.slice(0, lastIdx) : posts;

          if (fresh[0]?.name) {
            rule.lastSeenFullname = fresh[0].name;
          }

          // Keyword matching
          const kw = (rule.keyword || "").toLowerCase();
          const matches = fresh.filter((p: any) => {
            const hay = `${p?.title ?? ""}\n${p?.selftext ?? ""}`.toLowerCase();
            return kw && hay.includes(kw);
          });

          // Log-only / send block
          if (matches.length === 0) {
            console.log(`No matches for ${expoToken} in r/${rule.subreddit} this run.`);
          } else {
            // optional: de-dupe by fullname within this tick
            const seen = new Set<string>();

            for (const post of matches) {
              const fullname: string = post?.name ?? ""; // e.g., "t3_xxxxxx"
              if (fullname && seen.has(fullname)) continue;
              if (fullname) seen.add(fullname);

              const postTitle: string = post?.title ?? "(No title)";
              // Reddit API includes a "permalink" like "/r/sub/comments/abc123/title/"
              const postUrl: string =
                (post?.permalink ? `https://reddit.com${post.permalink}` : "") ||
                (post?.url ?? "");

              const title = `Match found in r/${rule.subreddit}`;
              const body = postTitle;

              // Your log-only send
              await sendExpoPush(expoToken, title, body);

              // Extra detailed log so you can inspect for duplicates/weirdness
              console.log(
                `→ Post matched:\n` +
                  `   - id: ${fullname}\n` +
                  `   - title: ${postTitle}\n` +
                  `   - url: ${postUrl}`
              );
            }
          }
        } catch {
          // ignore this rule this round
        }
      }

      // persist any lastSeen updates
      await env.KV.put(entry.name, JSON.stringify(rules));
    }

    if (isIncomplete(page)) {
      cursor = page.cursor;
    } else {
      break;
    }
  }
}

// ---------- Worker export ----------
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
      // swallow errors; cron runs again
    }
  },
};
