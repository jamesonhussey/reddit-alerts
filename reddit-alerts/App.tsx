import React, { useEffect, useState, useCallback } from "react";
import {
  Text, TextInput, View, Alert, Platform, FlatList, Pressable,
  StyleSheet, SafeAreaView, StatusBar, KeyboardAvoidingView, Linking,
} from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

// ==== Set your Worker URL ====
const WORKER_BASE_URL = "https://reddit-alerts-worker.reddit-alerts-worker.workers.dev";

// Notifications handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// ----- Types -----
type Rule = { subreddit: string; keyword: string; lastSeenFullname?: string | null };
type AlertItem = {
  id: string;
  subreddit: string;
  title: string;
  url: string;
  ts: number;         // detection time
  postedTs?: number;  // reddit creation time
};

type RootTabParamList = {
  Create: undefined;
  "My Rules": undefined;
  Alerts: undefined;
};

// ----- Shared: get (or synthesize) a push token -----
function useExpoToken() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (Device.isDevice) {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus === "granted") {
          try {
            const t = (await Notifications.getExpoPushTokenAsync({
              projectId: "9c115f37-91ae-42fc-92f5-cab46ddd7d9c",
            })).data;
            setToken(t);
          } catch {
            setToken(`debug:${Platform.OS}-${Date.now().toString(36)}`);
          }
        } else {
          setToken(`debug:${Platform.OS}-${Date.now().toString(36)}`);
        }
      } else {
        setToken(`debug:${Platform.OS}-${Date.now().toString(36)}`);
      }

      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
    })();
  }, []);

  return token;
}

// =======================================
// Screens
// =======================================

function CreateRuleScreen() {
  const expoPushToken = useExpoToken();
  const [subreddit, setSubreddit] = useState<string>("");
  const [keyword, setKeyword] = useState<string>("");

  const onSaveRule = useCallback(async () => {
    const tokenToUse =
      expoPushToken && expoPushToken.length > 0
        ? expoPushToken
        : `debug:${Platform.OS}-${Date.now().toString(36)}`;

    if (!subreddit || !keyword) return Alert.alert("Enter subreddit and keyword.");

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
        ? " (debug mode: check Worker logs for matches)"
        : "";
      Alert.alert("Saved!", `r/${subreddit} • "${keyword}"${modeMsg}`);
      setSubreddit("");
      setKeyword("");
    } catch (e: any) {
      Alert.alert("Network error", e?.message || String(e));
    }
  }, [expoPushToken, subreddit, keyword]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
        <Text style={styles.title}>Create Rule</Text>

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

        <Text style={styles.hint}>We’ll check new posts every ~2 minutes.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MyRulesScreen() {
  const expoPushToken = useExpoToken();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!expoPushToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${WORKER_BASE_URL}/rules/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expo_push_token: expoPushToken }),
      });
      const j = await res.json();
      setRules(j.rules || []);
    } catch {
      Alert.alert("Error", "Failed to load rules");
    } finally {
      setLoading(false);
    }
  }, [expoPushToken]);

  const del = useCallback(
    async (index: number) => {
      if (!expoPushToken) return;
      try {
        const res = await fetch(`${WORKER_BASE_URL}/rules/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expo_push_token: expoPushToken, index }),
        });
        if (res.ok) {
          load();
        } else {
          Alert.alert("Delete failed", await res.text());
        }
      } catch {
        Alert.alert("Error", "Delete failed");
      }
    },
    [expoPushToken, load]
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.container, { justifyContent: "flex-start" }]}>
        <Text style={styles.title}>My Rules</Text>
        <FlatList
          data={rules}
          refreshing={loading}
          onRefresh={load}
          keyExtractor={(_, i) => String(i)}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item, index }) => (
            <View style={styles.ruleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.ruleText}>r/{item.subreddit}</Text>
                <Text style={styles.ruleSubText}>"{item.keyword}"</Text>
              </View>
              <Pressable onPress={() => del(index)} style={styles.delBtn}>
                <Text style={styles.delBtnText}>Delete</Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.hint}>No rules yet.</Text>}
        />
        <Pressable style={[styles.button, { marginTop: 12 }]} onPress={load}>
          <Text style={styles.buttonText}>Refresh</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}


function AlertsScreen() {
  const expoPushToken = useExpoToken();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!expoPushToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${WORKER_BASE_URL}/alerts/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expo_push_token: expoPushToken, limit: 200 }),
      });
      const j = await res.json();
      const raw: AlertItem[] = Array.isArray(j.alerts) ? j.alerts : [];
      // dedupe by (id, subreddit)
      const seen = new Set<string>();
      const deduped = raw.filter(a => {
        const k = `${a.id}-${a.subreddit}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).sort((a, b) => b.ts - a.ts);
      setAlerts(deduped);
      
    } catch {
      Alert.alert("Error", "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, [expoPushToken]);

  useEffect(() => {
    load();
  }, [load]);

  const open = (url: string) => {
    if (!url) return;
    Linking.openURL(url).catch(() => Alert.alert("Could not open link", url));
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.container, { justifyContent: "flex-start" }]}>
        <Text style={styles.title}>Alerts</Text>
        <FlatList
          data={alerts}
          refreshing={loading}
          onRefresh={load}
          keyExtractor={(a, idx) => `${a.id}-${a.subreddit}-${a.ts}-${idx}`}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => open(item.url)} style={styles.alertRow}>
              <Text style={styles.ruleText}>{item.title}</Text>
              <Text style={styles.ruleSubText}>
                r/{item.subreddit} • {new Date((item.postedTs ?? item.ts)).toLocaleString()}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.hint}>No alerts yet.</Text>}
        />
        <Pressable style={[styles.button, { marginTop: 12 }]} onPress={load}>
          <Text style={styles.buttonText}>Refresh</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ----- Tabs root (typed) -----
const Tab = createBottomTabNavigator<RootTabParamList>();

// Tab.Navigator was showing an error due TypeScript and mismatched @react-navigation types. Added id={undefined as never} as a workaround for now.
export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        id={undefined as never}
        screenOptions={{ headerShown: false }}
      >
        <Tab.Screen name="Create" component={CreateRuleScreen} />
        <Tab.Screen name="My Rules" component={MyRulesScreen} />
        <Tab.Screen name="Alerts" component={AlertsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

// ===== Styles (yours) =====
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f7f7fb" },
  container: { flex: 1, padding: 20, gap: 12, justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "700", color: "#111827", marginBottom: 12 },
  input: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    color: "#111827",
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
  buttonText: { color: "#ffffff", fontWeight: "600", fontSize: 16 },
  hint: { color: "#6b7280", fontSize: 12, marginTop: 10 },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
  },
  ruleText: { color: "#111827", fontWeight: "600" },
  ruleSubText: { color: "#6b7280", marginTop: 2 },
  delBtn: { backgroundColor: "#ef4444", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginLeft: 12 },
  delBtnText: { color: "#fff", fontWeight: "600" },
  alertRow: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
  },
});

