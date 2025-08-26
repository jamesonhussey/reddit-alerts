// Handles rule management logic
import { Env, Rule, RulesIndex } from "./types";
import { json, readJson } from "./utils";

const INDEX_KEY = "rules_index";

export async function loadIndex(env: Env): Promise<Set<string>> {
	const raw = await env.KV.get(INDEX_KEY);
	if (!raw) return new Set();
	try { return new Set((JSON.parse(raw) as RulesIndex).tokens || []); }
	catch { return new Set(); }
}

export async function saveIndex(env: Env, set: Set<string>): Promise<void> {
	await env.KV.put(INDEX_KEY, JSON.stringify({ tokens: Array.from(set) }));
}

export async function addToIndex(env: Env, expoToken: string): Promise<void> {
	const set = await loadIndex(env);
	if (!set.has(expoToken)) { set.add(expoToken); await saveIndex(env, set); }
}

export async function removeFromIndex(env: Env, expoToken: string): Promise<void> {
	const set = await loadIndex(env);
	if (set.delete(expoToken)) await saveIndex(env, set);
}

export async function handleAddRule(req: Request, env: Env) {
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

export async function handleListRules(req: Request, env: Env) {
	const { expo_push_token } = await readJson(req);
	if (!expo_push_token) return json({ error: "Missing expo_push_token" }, { status: 400 });
	const key = `rules:${expo_push_token}`;
	const rules: Rule[] = JSON.parse((await env.KV.get(key)) || "[]");
	return json({ rules });
}

export async function handleDeleteRule(req: Request, env: Env) {
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