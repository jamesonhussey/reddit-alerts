// Handles notification sending logic

export async function sendExpoPush(expoToken: string, title: string, body: string) {
	// Skip emulators / debug tokens; keep logs
	if (!expoToken || expoToken.startsWith("debug:")) {
		console.log(`(log-only) Would send push to ${expoToken}: ${title} — ${body}`);
		return;
	}
	const payload = {
		to: expoToken,
		title,
		body,
		sound: null,
		priority: "default",
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
			// Uncomment below for debugging
			// console.log("Expo push sent, id:", data.id);
		} else {
			console.log("Expo push error:", { message: data.message, details: data.details });
		}
	} catch (err: any) {
		console.log("Expo push fetch failed:", err?.message || String(err));
	}
}