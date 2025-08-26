// Handles Reddit API interactions

export async function getAppAccessToken(client_id: string, client_secret: string): Promise<string> {
	if (!client_id || !client_secret) {
		console.log("Missing Reddit credentials: ", {
			hasClientId: !!client_id,
			hasClientSecret: !!client_secret,
		});
		throw new Error("Missing Reddit credentials");
	}
	const body = new URLSearchParams({
		grant_type: "client_credentials",
		scope: "read",
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

export async function fetchNewPosts(subreddit: string, accessToken: string, userAgent: string) {
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