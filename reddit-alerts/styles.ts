import { StyleSheet } from "react-native";

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
  titleImageSmall: { width: 25, height: 25, borderRadius: 5, marginRight: 8, justifyContent: "center", marginBottom: 12 },
});

export default styles;
