# Release compatibility matrix

cookclub 1.0 uses Bun 1.3.14 and Node 22.13 or newer. Dependencies are
exactly pinned in workspace manifests and `bun.lock`.

## Intentional compatibility holds

- Mobile is held to Expo SDK 57's supported matrix: React Native 0.86.2 and
  React 19.2.3.
- Expo-managed native packages are held to `expo install` recommendations,
  including Sentry React Native 7.11, FlashList 2.0.2, Gesture Handler 2.32,
  Screens 4.26, and Worklets 0.10.1.
- TypeScript is held to 6.0.3 because Expo 57 and the current TypeScript ESLint
  parser do not yet support TypeScript 7.
- Babel is held to the latest 7.x release because Expo 57 does not support
  Babel 8.
- ESLint is held to 9.39.5 because the React lint plugin stack does not yet
  support ESLint 10 completely.
- Node type declarations are held to the latest Node 22 release so local and CI
  types match the standardized Node 22 runtime.

All other dependencies are eligible for routine updates. CI runs
`expo install --check` and Expo Doctor so an accidental native matrix drift is
caught before release.
