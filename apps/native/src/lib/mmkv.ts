import { createMMKV } from "react-native-mmkv";

// Omitting an id preserves MMKV's existing default store across the v4 upgrade.
export const storage = createMMKV();
