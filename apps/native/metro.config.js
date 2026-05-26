const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const {
  wrapWithReanimatedMetroConfig,
} = require("react-native-reanimated/metro-config");

// eslint-disable-next-line no-undef
const projectRoot = __dirname;
const config = getSentryExpoConfig(projectRoot);

config.resolver.unstable_enablePackageExports = true;

module.exports = wrapWithReanimatedMetroConfig(config);
