// Utility/helper functions

const JSON_HEADERS: Record<string, string> = {
	"content-type": "application/json; charset=utf-8",
};

export function withCORS(init: ResponseInit = {}, body?: BodyInit | null) {
	const headers = new Headers(init.headers || {});
	headers.set("Access-Control-Allow-Origin", "*");
	headers.set("Access-Control-Allow-Headers", "Content-Type");
	headers.set("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
	return new Response(body ?? null, { ...init, headers });
}

export function json(data: unknown, init: ResponseInit = {}) {
	const headers = new Headers(init.headers || {});
	for (const [k, v] of Object.entries(JSON_HEADERS)) headers.set(k, v);
	return withCORS({ ...init, headers }, JSON.stringify(data));
}

export async function readJson<T = any>(req: Request): Promise<T> {
	try {
		return await req.json();
	} catch {
		throw new Error("Invalid JSON");
	}
}