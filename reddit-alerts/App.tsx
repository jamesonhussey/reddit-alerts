import React, { useEffect, useState } from "react";
import { Button, Text, TextInput, View, Alert, Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { SafeAreaView, StatusBar, Pressable, KeyboardAvoidingView, StyleSheet } from "react-native";

const REDDIT_CLIENT_ID = "QsQmq8vwjVqTKaHrUljEmg";
const WORKER_BASE_URL = "https://reddit-alerts-worker.reddit-alerts-worker.workers.dev"; // e.g. https://alerts.yourdomain.workers.dev

// Reddit OAuth endpoints
const discovery = {
  authorizationEndpoint: "https://www.reddit.com/api/v1/authorize",
  tokenEndpoint: "https://www.reddit.com/api/v1/access_token",
  revocationEndpoint: "https://www.reddit.com/api/v1/revoke_token",
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,   // replaces shouldShowAlert
    shouldShowList: true,     // new in recent SDKs
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: REDDIT_CLIENT_ID,
      responseType: AuthSession.ResponseType.Code,
      scopes: ["identity", "read"],
      redirectUri: AuthSession.makeRedirectUri({ scheme: "redditalerts" }),
      usePKCE: true,
      state: Math.random().toString(36).slice(2),
      extraParams: { duration: "permanent" } // get a refresh token
    },
    discovery
  );

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);

  const [subreddit, setSubreddit] = useState<string>("");
  const [keyword, setKeyword] = useState<string>("");

  useEffect(() => {
    (async () => {
      if (Device.isDevice) {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted") return;
        const token = (await Notifications.getExpoPushTokenAsync({
          projectId: "9c115f37-91ae-42fc-92f5-cab46ddd7d9c"  // the UUID EAS just created
        })).data;
        setExpoPushToken(token);
      }
      if (Platform.OS === "android") {
        Notifications.setNotificationChannelAsync("default", {
          name: "default", importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (response?.type === "success") {
        const { code } = response.params;
        // Exchange code for tokens (PKCE)
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: AuthSession.makeRedirectUri({ scheme: "redditalerts" }),
          client_id: REDDIT_CLIENT_ID,
          code_verifier: request?.codeVerifier ?? "",
        }).toString();

        const r = await fetch(discovery.tokenEndpoint!, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " + btoa(`${REDDIT_CLIENT_ID}:`), // no secret for installed app
          },
          body,
        });

        const json = await r.json();
        if (json.error) {
          Alert.alert("Auth error", JSON.stringify(json));
          return;
        }
        setAccessToken(json.access_token);
        setRefreshToken(json.refresh_token); // store securely in app state for demo
        // Send refresh token + push token to backend to create a user record
        if (expoPushToken) {
          await fetch(`${WORKER_BASE_URL}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              refresh_token: json.refresh_token,
              client_id: REDDIT_CLIENT_ID,
              expo_push_token: expoPushToken,
            }),
          });
        }
      }
    })();
  }, [response]);

  const onSaveRule = async () => {
  // allow debug mode when we don't have a real push token
  const tokenToUse =
    expoPushToken && expoPushToken.length > 0
      ? expoPushToken
      : `debug:${Platform.OS}-${Date.now().toString(36)}`;

  if (!subreddit || !keyword) return Alert.alert("Enter subreddit and keyword.");

  console.log("Saving rule with token:", tokenToUse);

  try {
    const res = await fetch(`${WORKER_BASE_URL}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subreddit: subreddit.trim(),
        keyword: keyword.trim(),
        expo_push_token: tokenToUse,
      }),
    });

    if (!res.ok) {
      const msg = await res.text();
      return Alert.alert("Error saving rule", msg);
    }

    const modeMsg = tokenToUse.startsWith("debug:")
      ? " (debug mode: no real push, check Worker logs)"
      : "";
    Alert.alert("Saved!", `You'll be alerted for r/${subreddit} posts containing "${keyword}".${modeMsg}`);
    setSubreddit("");
    setKeyword("");
  } catch (e: any) {
    Alert.alert("Network error", e?.message || String(e));
  }
};

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <Text style={styles.title}>Reddit Alerts</Text>

        <TextInput
          placeholder="subreddit (no r/)"
          value={subreddit}
          onChangeText={setSubreddit}
          autoCapitalize="none"
          placeholderTextColor="#6b7280"
          style={styles.input}
        />
        <TextInput
          placeholder="keyword or phrase"
          value={keyword}
          onChangeText={setKeyword}
          autoCapitalize="none"
          placeholderTextColor="#6b7280"
          style={styles.input}
        />

        <Pressable onPress={onSaveRule} style={styles.button}>
          <Text style={styles.buttonText}>Save alert rule</Text>
        </Pressable>

        {/* Optional tiny hint */}
        <Text style={styles.hint}>
          No login needed. We’ll check new posts every ~2 minutes.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f7f7fb", // light, consistent background (no pure white glare)
  },
  container: {
    flex: 1,
    padding: 20,
    gap: 12,
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 12,
  },
  input: {
    backgroundColor: "#ffffff",   // solid white so it’s readable in dark mode too
    borderWidth: 1,
    borderColor: "#d1d5db",
    color: "#111827",             // force dark text (prevents white-on-white)
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  button: {
    backgroundColor: "#2563eb",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 16,
  },
  hint: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 10,
  },
});
