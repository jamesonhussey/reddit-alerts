import React, { useState, useCallback, useEffect } from "react";
import { Text, View, Alert, FlatList, Pressable, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import useExpoToken from "../hooks/useExpoToken";
import styles from "../styles";

const WORKER_BASE_URL = "https://reddit-alerts-worker.reddit-alerts-worker.workers.dev";

type Rule = { subreddit: string; keyword: string; lastSeenFullname?: string | null };

export default function MyRulesScreen() {
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
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <Image source={require("../assets/icon.png")} style={styles.titleImageSmall} resizeMode="contain" />
          <Text style={styles.title}>My Rules</Text>
        </View>
        <FlatList data={rules} refreshing={loading} onRefresh={load} keyExtractor={(_, i) => String(i)} ItemSeparatorComponent={() => <View style={{ height: 8 }} />} renderItem={({ item, index }) => (
          <View style={styles.ruleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.ruleText}>r/{item.subreddit}</Text>
              <Text style={styles.ruleSubText}>"{item.keyword}"</Text>
            </View>
            <Pressable onPress={() => del(index)} style={styles.delBtn}>
              <Text style={styles.delBtnText}>Delete</Text>
            </Pressable>
          </View>
        )} ListEmptyComponent={<Text style={styles.hint}>No rules yet.</Text>} />
        <Pressable style={[styles.button, { marginTop: 12 }]} onPress={load}>
          <Text style={styles.buttonText}>Refresh</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}