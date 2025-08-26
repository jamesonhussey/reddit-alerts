import { useEffect, useState } from "react";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export default function useExpoToken() {
  const [token, setToken] = useState<string | null>(null);
  const TOKEN_KEY = "ra:pushToken";

  useEffect(() => {
    (async () => {
      let finalToken: string | null = null;
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
      if (!finalToken) {
        const saved = await AsyncStorage.getItem(TOKEN_KEY);
        if (saved) {
          finalToken = saved;
        } else {
          finalToken = `debug:${Platform.OS}-${Math.random().toString(36).slice(2)}`;
          await AsyncStorage.setItem(TOKEN_KEY, finalToken);
        }
      } else {
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
