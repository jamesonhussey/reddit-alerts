// Type definitions for backend

export interface Env {
	KV: KVNamespace;
	REDDIT_USER_AGENT: string;
	REDDIT_CLIENT_ID: string;
	REDDIT_CLIENT_SECRET: string; // set via wrangler secret
}

export type Rule = {
	subreddit: string;
	keyword: string;
	lastSeenFullname?: string | null;
};

export type AlertItem = {
	id: string;
	subreddit: string;
	title: string;
	url: string;
	ts: number;          // Date.now() - Detection time
	postedTs?: number;   // Reddit's post timestamp (ms)
};

export type RulesIndex = { tokens: string[] };