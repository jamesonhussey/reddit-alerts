import React, { useEffect, useState } from "react";
import { Button, Text, TextInput, View, Alert, Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

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
    if (!expoPushToken) return Alert.alert("Enable notifications first.");
    if (!subreddit || !keyword) return Alert.alert("Enter subreddit and keyword.");
    const res = await fetch(`${WORKER_BASE_URL}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subreddit,
        keyword,
        expo_push_token: expoPushToken,
      }),
    });
    if (!res.ok) return Alert.alert("Error saving rule");
    Alert.alert("Saved!", `You'll be alerted for r/${subreddit} posts containing "${keyword}".`);
    setSubreddit(""); setKeyword("");
  };

  return (
    <View style={{ flex:1, padding:16, gap:12, justifyContent:"center" }}>
      <Text style={{ fontSize:24, fontWeight:"600", marginBottom:12 }}>Reddit Alerts</Text>
      {accessToken ? (
        <Text>Signed in. Add an alert rule:</Text>
      ) : (
        <Button title="Sign in with Reddit" onPress={() => promptAsync()} disabled={!request} />
      )}

      <TextInput
        placeholder="subreddit (no r/)"
        value={subreddit}
        onChangeText={setSubreddit}
        autoCapitalize="none"
        style={{ borderWidth:1, padding:10, borderRadius:8 }}
      />
      <TextInput
        placeholder="keyword or phrase"
        value={keyword}
        onChangeText={setKeyword}
        autoCapitalize="none"
        style={{ borderWidth:1, padding:10, borderRadius:8 }}
      />
      <Button title="Save alert rule" onPress={onSaveRule} />
    </View>
  );
}
