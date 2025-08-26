import React, { useState, useCallback, useEffect } from "react";
import { Text, View, Alert, FlatList, Pressable, Image, Linking } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import useExpoToken from "../hooks/useExpoToken";
import styles from "../styles";

const WORKER_BASE_URL = "https://reddit-alerts-worker.reddit-alerts-worker.workers.dev";

type AlertItem = {
  id: string;
  subreddit: string;
  title: string;
  url: string;
  ts: number;
  postedTs?: number;
};

export default function AlertsScreen() {
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
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <Image source={require("../assets/icon.png")} style={styles.titleImageSmall} resizeMode="contain" />
          <Text style={styles.title}>Alerts</Text>
        </View>
        <FlatList data={alerts} refreshing={loading} onRefresh={load} keyExtractor={(a, idx) => `${a.id}-${a.subreddit}-${a.ts}-${idx}`} ItemSeparatorComponent={() => <View style={{ height: 8 }} />} renderItem={({ item }) => (
          <Pressable onPress={() => open(item.url)} style={styles.alertRow}>
            <Text style={styles.ruleText}>{item.title}</Text>
            <Text style={styles.ruleSubText}>r/{item.subreddit} • {new Date((item.postedTs ?? item.ts)).toLocaleString()}</Text>
          </Pressable>
        )} ListEmptyComponent={<Text style={styles.hint}>No alerts yet.</Text>} />
        <Pressable style={[styles.button, { marginTop: 12 }]} onPress={load}>
          <Text style={styles.buttonText}>Refresh</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}