import { defineConfig, globalIgnores } from "eslint/config";
import nativeConfig from "eslint-config-universe/flat/native.js";
import nodeConfig from "eslint-config-universe/flat/node.js";
import webConfig from "eslint-config-universe/flat/web.js";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/.astro/**",
    "**/.expo/**",
    "**/.wrangler/**",
    "**/coverage/**",
    "apps/native/ios/**",
    "apps/native/android/**",
    "apps/admin/src/routeTree.gen.ts",
    "apps/**/worker-configuration.d.ts",
  ]),
  {
    files: ["apps/native/**/*.{js,jsx,ts,tsx}"],
    extends: [nativeConfig],
    rules: {
      // TypeScript already validates namespace members, and this rule can't
      // parse the SWC-compiled builds of Expo SDK 58 modules (false positives
      // on e.g. Notifications.AndroidImportance).
      "import/namespace": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["apps/{admin,web}/**/*.{js,jsx,ts,tsx}"],
    extends: [webConfig],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: [
      "apps/{api,images,recipe-ai}/**/*.{js,jsx,ts,tsx}",
      "packages/**/*.{js,jsx,ts,tsx}",
      "tooling/**/*.{js,jsx,ts,tsx}",
    ],
    extends: [nodeConfig],
  },
]);
