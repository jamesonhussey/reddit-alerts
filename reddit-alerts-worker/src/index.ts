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

// ---- token index (to avoid KV.list) ----
const INDEX_KEY = "rules_index";
type RulesIndex = { tokens: string[] };

async function loadIndex(env: Env): Promise<Set<string>> {
  const raw = await env.KV.get(INDEX_KEY);
  if (!raw) return new Set();
  try { return new Set((JSON.parse(raw) as RulesIndex).tokens || []); }
  catch { return new Set(); }
}

async function saveIndex(env: Env, set: Set<string>): Promise<void> {
  await env.KV.put(INDEX_KEY, JSON.stringify({ tokens: Array.from(set) }));
}

async function addToIndex(env: Env, expoToken: string): Promise<void> {
  const set = await loadIndex(env);
  if (!set.has(expoToken)) { set.add(expoToken); await saveIndex(env, set); }
}

async function removeFromIndex(env: Env, expoToken: string): Promise<void> {
  const set = await loadIndex(env);
  if (set.delete(expoToken)) await saveIndex(env, set);
}

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
    scope: "read", // This is optional but harmless. some setups expect a scope
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

  const txt = await resp.text();
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
  // Skip emulators / debug tokens; keep logs
  if (!expoToken || expoToken.startsWith("debug:")) {
    console.log(`(log-only) Would send push to ${expoToken}: ${title} — ${body}`);
    return;
  }

  const payload = {
    to: expoToken,
    title,
    body,
    sound: null,           // "default" for sound
    priority: "default",   // can change to "high" but idk why this would be considered high priority
    channelId: "default",
  };

  try {
    const resp = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();

    if (!resp.ok) {
      console.log("Expo push HTTP error:", resp.status, text);
      return;
    }

    // Response shape for single message:
    // { data: { status: "ok", id: "..."} }  or  { data: { status: "error", message, details } }
    let json: any;
    try { json = JSON.parse(text); } catch {
      console.log("Expo push: non-JSON response:", text);
      return;
    }

    const data = json?.data;
    if (!data) {
      console.log("Expo push: unexpected response:", json);
      return;
    }

    if (data.status === "ok") {
      // Optional: log the ticket id for receipts flow
      // console.log("Expo push sent, id:", data.id);
    } else {
      console.log("Expo push error:", { message: data.message, details: data.details });
    }
  } catch (err: any) {
    console.log("Expo push fetch failed:", err?.message || String(err));
  }
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
  await addToIndex(env, expo_push_token);

  console.log("Saved rule:", { key, count: rules.length });
  return json({ ok: true });
}


async function handleListRules(req: Request, env: Env) {
  const { expo_push_token } = await readJson(req);
  if (!expo_push_token) return json({ error: "Missing expo_push_token" }, { status: 400 });
  const key = `rules:${expo_push_token}`;
  const rules: Rule[] = JSON.parse((await env.KV.get(key)) || "[]");
  return json({ rules });
}

async function handleDeleteRule(req: Request, env: Env) {
  const { expo_push_token, index } = await readJson(req);
  if (!expo_push_token || typeof index !== "number") {
    return json({ error: "Missing expo_push_token or index" }, { status: 400 });
  }

  const key = `rules:${expo_push_token}`;
  const rules: Rule[] = JSON.parse((await env.KV.get(key)) || "[]");

  if (index < 0 || index >= rules.length) {
    return json({ error: "Index out of range" }, { status: 400 });
  }

  rules.splice(index, 1);

  if (rules.length === 0) {
    await env.KV.delete(key);
    await removeFromIndex(env, expo_push_token);
    console.log("Deleted empty rules key and removed from index:", key);
  } else {
    await env.KV.put(key, JSON.stringify(rules));
  }

  return json({ ok: true });
}


type AlertItem = {
  id: string;
  subreddit: string;
  title: string;
  url: string;
  ts: number;          // Date.now() - Detection time
  postedTs?: number;   // Reddit's post timestamp (ms)
};

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

  // ---- NEW: read the token index ONCE (no KV.list()) ----
  const tokenSet = await loadIndex(env);            // Set<string>
  const tokens = Array.from(tokenSet);
  console.log(`Cron start: index has ${tokens.length} token(s)`);

  for (const expoToken of tokens) {
    const rulesKey = `rules:${expoToken}`;
    const rulesStr = await env.KV.get(rulesKey);

    // If key missing or empty, prune + remove from index + clear alerts and continue
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

    // Load alert buffer and an "existing" index for de-dupe across runs
    const alertsKey = `alerts:${expoToken}`;
    let alertBuf = JSON.parse((await env.KV.get(alertsKey)) || "[]") as any[];
    const existing = new Set<string>(
      alertBuf.map((a: { id: string; subreddit: string }) => `${a?.id ?? ""}-${a?.subreddit ?? ""}`)
    );

    let changed = false; // whether we updated lastSeenFullname and need to persist rules

    for (const rule of rules) {
      try {
        const posts = await fetchNewPosts(rule.subreddit, appToken, env.REDDIT_USER_AGENT);

        // Only consider posts since last seen
        const lastIdx = rule.lastSeenFullname
          ? posts.findIndex((p: any) => p?.name === rule.lastSeenFullname)
          : -1;
        const fresh = lastIdx >= 0 ? posts.slice(0, lastIdx) : posts;

        if (fresh[0]?.name && fresh[0].name !== rule.lastSeenFullname) {
          rule.lastSeenFullname = fresh[0].name;
          changed = true;
        }

        // Keyword matching (title + selftext)
        const kw = (rule.keyword || "").toLowerCase();
        const matches = fresh.filter((p: any) => {
          const hay = `${p?.title ?? ""}\n${p?.selftext ?? ""}`.toLowerCase();
          return kw && hay.includes(kw);
        });

        if (matches.length === 0) {
          // quiet now to reduce logs; uncomment if needed:
          // console.log(`No matches for ${expoToken} in r/${rule.subreddit} this run.`);
        } else {
          // De-dupe within this cron tick
          const seenThisRun = new Set<string>();

          for (const post of matches) {
            const fullname: string = post?.name ?? ""; // e.g., t3_xxxxxx
            const postTitle: string = post?.title ?? "(No title)";
            const postUrl: string =
              (post?.permalink ? `https://reddit.com${post.permalink}` : "") ||
              (post?.url ?? "");
            const combinedKey = `${fullname}-${rule.subreddit}`;

            // Skip if already recorded/sent this post for this subreddit
            if (existing.has(combinedKey) || (fullname && seenThisRun.has(combinedKey))) {
              continue;
            }

            if (fullname) seenThisRun.add(combinedKey);
            existing.add(combinedKey);

            // Send (or log-only if your sendExpoPush is stubbed)
            await sendExpoPush(expoToken, `Match found in r/${rule.subreddit}`, postTitle);

            // Detail log
            console.log(
              `→ Post matched:\n` +
                `   - id: ${fullname}\n` +
                `   - title: ${postTitle}\n` +
                `   - url: ${postUrl}`
            );

            // Reddit timestamp (seconds) -> ms; fallback to now
            const postedTs =
              typeof post?.created_utc === "number"
                ? Math.round(post.created_utc * 1000)
                : Date.now();

            // Prepend newest alert
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
        // ignore this rule this round
      }
    }

    // Cap stored alerts per device to keep KV small
    if (alertBuf.length > 200) alertBuf = alertBuf.slice(0, 200);
    await env.KV.put(alertsKey, JSON.stringify(alertBuf));

    // Persist any lastSeen updates
    if (changed) {
      await env.KV.put(rulesKey, JSON.stringify(rules));
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
      // swallow errors -> cron runs again
    }
  },
};