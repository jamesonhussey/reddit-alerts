import React, { useState, useCallback } from "react";
import { Text, TextInput, View, Alert, Platform, Pressable, KeyboardAvoidingView, Image, StatusBar, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import useExpoToken from "../hooks/useExpoToken";
import styles from "../styles";

const WORKER_BASE_URL = "https://reddit-alerts-worker.reddit-alerts-worker.workers.dev";

export default function CreateRuleScreen() {
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
        body: JSON.stringify({ subreddit: subreddit.trim(), keyword: keyword.trim(), expo_push_token: tokenToUse }),
      });
      if (!res.ok) {
        const msg = await res.text();
        return Alert.alert("Error saving rule", msg);
      }
      const modeMsg = tokenToUse.startsWith("debug:") ? " (debug mode: check Worker logs for matches)" : "";
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
        <Image source={require("../assets/icon.png")} style={{ width: 96, height: 96, borderRadius: 20, marginBottom: 0 }} resizeMode="contain" />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
        <Text style={styles.title}>Create Alert Rule</Text>
        <TextInput placeholder="subreddit (no r/)" value={subreddit} onChangeText={setSubreddit} autoCapitalize="none" placeholderTextColor="#6b7280" style={styles.input} />
        <TextInput placeholder="keyword or phrase" value={keyword} onChangeText={setKeyword} autoCapitalize="none" placeholderTextColor="#6b7280" style={styles.input} />
        <Pressable onPress={onSaveRule} style={styles.button}>
          <Text style={styles.buttonText}>Save alert rule</Text>
        </Pressable>
        <Text style={styles.hint}>We’ll check new posts every ~2 minutes.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
