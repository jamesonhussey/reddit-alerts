import React, { useState } from "react";
import { Text, TextInput, View, Alert, FlatList, Pressable, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import useExpoToken from "../hooks/useExpoToken";
import styles from "../styles";
import { BUNDLES } from "../constants/bundles";
import addRulesForBundle from "../utils/addRulesForBundle";

export default function BundlesScreen() {
  const expoPushToken = useExpoToken();
  const [query, setQuery] = useState<string>("");
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);

  const onAddBundle = async (bundle) => {
    if (!expoPushToken) return Alert.alert("Token not ready", "Try again in a moment.");
    if (!query.trim()) return Alert.alert("Enter a keyword", "Type a keyword to match.");
    setBusy(true);
    try {
      const { added, skipped } = await addRulesForBundle(
        expoPushToken,
        bundle,
        query.trim()
      );
      Alert.alert("Bundle added", `Added ${added} rule(s). Skipped ${skipped}.`);
      setQuery("");
      setSelected(null);
    } catch (e) {
      Alert.alert("Error", e?.message || "Failed to add bundle");
    } finally {
      setBusy(false);
    }
  };

  const renderBundle = ({ item }) => (
    <Pressable onPress={() => setSelected(item)} style={styles.bundleCard}>
      <Text style={styles.ruleText}>{item.name}</Text>
      {!!item.description && <Text style={styles.ruleSubText}>{item.description}</Text>}
      <Text style={styles.bundleSubs}>{item.subreddits.join(" • ")}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.container, { justifyContent: "flex-start" }]}> 
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <Image source={require("../assets/icon.png")} style={styles.titleImageSmall} resizeMode="contain" />
          <Text style={styles.title}>Rule Bundles</Text>
        </View>
        {selected ? (
          <View style={{ gap: 10, marginBottom: 12 }}>
            <Text style={styles.ruleText}>Keyword for “{selected.name}”</Text>
            <TextInput placeholder="keyword or phrase" value={query} onChangeText={setQuery} autoCapitalize="none" placeholderTextColor="#6b7280" style={styles.input} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable disabled={busy} onPress={() => onAddBundle(selected)} style={[styles.button, busy && { opacity: 0.6 }]}> 
                <Text style={styles.buttonText}>{busy ? "Adding..." : "Add Bundle"}</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={() => { setSelected(null); setQuery(""); }} style={[styles.cancelButton]}>
                <Text style={styles.buttonText}>Cancel</Text>
              </Pressable>
            </View>
            <Text style={styles.ruleSubText}>Subreddits: {selected.subreddits.join(", ")}</Text>
          </View>
        ) : null}
        <FlatList data={BUNDLES} keyExtractor={(b) => b.id} ItemSeparatorComponent={() => <View style={{ height: 8 }} />} renderItem={renderBundle} ListEmptyComponent={<Text style={styles.hint}>No bundles defined.</Text>} />
      </View>
    </SafeAreaView>
  );
}
