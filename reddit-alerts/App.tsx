import React, { useEffect, useState, useCallback } from "react";
import {
  Text, TextInput, View, Alert, Platform, FlatList, Pressable,
  StyleSheet, StatusBar, KeyboardAvoidingView, Linking, Image
} from "react-native";
import {SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

type Bundle = {
  id: string;
  name: string;
  description?: string;
  subreddits: string[];
};

const BUNDLES: Bundle[] = [
  {
    id: "collectibles-cards",
    name: "Trading Cards",
    description: "Pokémon, MTG trades",
    subreddits: ["mtgmarketplace", "pkmntcgtrades", "pokemontrades"],
  },
  {
    id: "free-gaming",
    name: "Free Gaming",
    description: "Free giveaways and gifted games",
    subreddits: ["FreeGameFindings", "GiftofGames", "PlayItForward"],
  },
  {
    id: "game-sales-expanded",
    name: "Gaming Sales (All Platforms)",
    description: "Game and console deals across PC, Xbox, PlayStation, Switch",
    subreddits: [
      "consoledeals",
      "GameDeals",
      "GameSale",
      "GamingDeals",
      "GreatXboxDeals",
      "NintendoSwitchDeals",
      "PS4Deals",
      "ps5deals"
    ],
  },
  {
    id: "general-tech",
    name: "Tech Deals (General)",
    description: "Finished tech (monitors, smartwatches, laptops)",
    subreddits: [
      "apple",
      "battlestations",
      "buildapcsales",
      "GameDeals",
      "hardwareswap",
      "techdeals",
      "wearabledeals"
    ],
  },
  {
    id: "sneakers-streetwear-extended",
    name: "Sneakers & Streetwear (Extended)",
    description: "Sneaker & streetwear deals, trades, etc.",
    subreddits: [
      "Adidas",
      "fashionreps",
      "FashionRepsBST",
      "Jordans",
      "kicksmarket",
      "Nike",
      "repsneakers", 
      "Shoeexchange",
      "sneakermarket",
      "sneakers",
      "SneakerDeals",
      "SneakerTrades",
      "StreetwearSwap",
      "supremeclothing"
    ],
  },
  {
    id: "steam-sales",
    name: "Steam",
    description: "Steam sales and giveaways",
    subreddits: [
      "SteamDeals",
      "Steam_giveaway",
    ],
  },
  {
    id: "tech-hardware",
    name: "PC Hardware",
    description: "Components & hardware deals",
    subreddits: ["buildapc", "buildapcsales", "GameDeals", "hardwareswap", "pcmasterrace"],
  },
];


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
  Bundles: undefined;
  "My Rules": undefined;
  Alerts: undefined;
};

// ----- Shared: get (or synthesize) a push token -----
function useExpoToken() {
  const [token, setToken] = useState<string | null>(null);
  const TOKEN_KEY = "ra:pushToken";

  useEffect(() => {
    (async () => {
      let finalToken: string | null = null;

      // Try to get a real Expo token first
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
            finalToken = t;
          } catch {
            // fall through to debug token
          }
        }
      }

      // If no real token, load or create a stable debug token
      if (!finalToken) {
        const saved = await AsyncStorage.getItem(TOKEN_KEY);
        if (saved) {
          finalToken = saved;
        } else {
          finalToken = `debug:${Platform.OS}-${Math.random().toString(36).slice(2)}`;
          await AsyncStorage.setItem(TOKEN_KEY, finalToken);
        }
      } else {
        // If we *did* get a real token, store it so all screens use the same value
        await AsyncStorage.setItem(TOKEN_KEY, finalToken);
      }

      setToken(finalToken);

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

async function addRulesForBundle(
  workerUrl: string,
  expoToken: string,
  bundle: Bundle,
  keyword: string
): Promise<{ added: number; skipped: number }> {
  // 1) Load existing rules to avoid duplicates
  const listRes = await fetch(`${workerUrl}/rules/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expo_push_token: expoToken }),
  });
  const listJson = await listRes.json();
  const existing: { subreddit: string; keyword: string }[] = listJson.rules || [];
  const exists = new Set(existing.map(r => `${r.subreddit.toLowerCase()}::${r.keyword.toLowerCase()}`));

  // 2) Figure out which subs are actually new for this keyword
  const toAdd = bundle.subreddits.filter(
    sub => !exists.has(`${sub.toLowerCase()}::${keyword.toLowerCase()}`)
  );

  // 3) Post ONE BY ONE to avoid KV race conditions
  let added = 0;
  for (const subreddit of toAdd) {
    const res = await fetch(`${workerUrl}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subreddit, keyword, expo_push_token: expoToken }),
    });
    if (res.ok) added += 1;

    // tiny delay reduces contention further (optional)
    await new Promise(r => setTimeout(r, 50));
  }

  const skipped = bundle.subreddits.length - added;
  return { added, skipped };
}

// =======================================
// Screens
// =======================================

function CreateRuleScreen() {
  const expoPushToken = useExpoToken();
  const [subreddit, setSubreddit] = useState<string>("");
  const [keyword, setKeyword] = useState<string>("");

  const onSaveRule = useCallback(async () => {
    const tokenToUse = expoPushToken;
    if (!tokenToUse) return Alert.alert("Token not ready", "Try again in a moment.");


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
      <View style={{ paddingTop: 32, alignItems: "center" }}>
        <Image
          source={require("./assets/icon.png")}
          style={{ width: 96, height: 96, borderRadius: 20, marginBottom: 0 }}
          resizeMode="contain"
        />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <Text style={styles.title}>Create Alert Rule</Text>

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

        {/* Title row with small logo on the left */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <Image
            source={require("./assets/icon.png")}
            style={styles.titleImageSmall}
            resizeMode="contain"
          />
          <Text style={styles.title}>My Rules</Text>
        </View>

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
        {/* Uncomment this if you want to show the expoPushToken in the app itself for debugging purposes */}
        {/* <Pressable style={[styles.button, { marginTop: 12 }]} onPress={load}>
          <Text style={styles.buttonText}>
            {expoPushToken ? expoPushToken : "Refresh"}
          </Text>
        </Pressable> */}

      </View>
    </SafeAreaView>
  );
}



function AlertsScreen() {
  const expoPushToken = useExpoToken();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

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
        {/* Title row with small logo on the left */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <Image
            source={require("./assets/icon.png")}
            style={styles.titleImageSmall}
            resizeMode="contain"
          />
          <Text style={styles.title}>Alerts</Text>
        </View>
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

function BundlesScreen() {
  const expoPushToken = useExpoToken();
  const [query, setQuery] = useState<string>(""); // keyword for the selected bundle
  const [selected, setSelected] = useState<Bundle | null>(null);
  const [busy, setBusy] = useState(false);

  const onAddBundle = async (bundle: Bundle) => {
    if (!expoPushToken) return Alert.alert("Token not ready", "Try again in a moment.");
    if (!query.trim()) return Alert.alert("Enter a keyword", "Type a keyword to match.");
    setBusy(true);
    try {
      const { added, skipped } = await addRulesForBundle(
        WORKER_BASE_URL,
        expoPushToken,
        bundle,
        query.trim()
      );
      Alert.alert("Bundle added", `Added ${added} rule(s). Skipped ${skipped} existing.`);
      setQuery("");
      setSelected(null);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to add bundle");
    } finally {
      setBusy(false);
    }
  };

  const renderBundle = ({ item }: { item: Bundle }) => (
    <Pressable
      onPress={() => setSelected(item)}
      style={styles.bundleCard}
    >
      <Text style={styles.ruleText}>{item.name}</Text>
      {!!item.description && <Text style={styles.ruleSubText}>{item.description}</Text>}
      <Text style={styles.bundleSubs}>{item.subreddits.join(" • ")}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.container, { justifyContent: "flex-start" }]}>
        {/* Title row with small logo on the left */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <Image
            source={require("./assets/icon.png")}
            style={styles.titleImageSmall}
            resizeMode="contain"
          />
          <Text style={styles.title}>Rule Bundles</Text>
        </View>

        {/* Keyword input when a bundle is selected */}
        {selected ? (
          <View style={{ gap: 10, marginBottom: 12 }}>
            <Text style={styles.ruleText}>Keyword for “{selected.name}”</Text>
            <TextInput
              placeholder="keyword or phrase"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              placeholderTextColor="#6b7280"
              style={styles.input}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                disabled={busy}
                onPress={() => onAddBundle(selected)}
                style={[styles.button, busy && { opacity: 0.6 }]}
              >
                <Text style={styles.buttonText}>{busy ? "Adding..." : "Add Bundle"}</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => { setSelected(null); setQuery(""); }}
                style={[styles.cancelButton]}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </Pressable>
            </View>
            <Text style={styles.ruleSubText}>
              Subreddits: {selected.subreddits.join(", ")}
            </Text>
          </View>
        ) : null}

        <FlatList
          data={BUNDLES}
          keyExtractor={(b) => b.id}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={renderBundle}
          ListEmptyComponent={<Text style={styles.hint}>No bundles defined.</Text>}
        />
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
        <Tab.Screen name="Bundles" component={BundlesScreen} />
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
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },
  cancelButton: {
    backgroundColor: "#6b7280",
    paddingVertical: 12,
    paddingHorizontal: 16,
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
  bundleCard: {
  backgroundColor: "#fff",
  borderWidth: 1,
  borderColor: "#e5e7eb",
  borderRadius: 10,
  padding: 12,
  },
  bundleSubs: {
    color: "#6b7280",
    marginTop: 6,
    fontSize: 12,
  },
  titleImageSmall: { width: 25, height: 25, borderRadius: 5, marginRight: 8, justifyContent: "center", marginBottom: 12, },
});