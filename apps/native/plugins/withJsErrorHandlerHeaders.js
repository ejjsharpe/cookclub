const { withPodfile } = require("@expo/config-plugins");
const {
  mergeContents,
} = require("@expo/config-plugins/build/utils/generateCode");

/**
 * Workaround for https://github.com/margelo/nitro/issues/2052 (open).
 *
 * On React Native 0.88.1 with frameworks (we use `useFrameworks: "dynamic"`
 * and build RN from source), cxxreact/ErrorUtils.h is a deprecated shim that
 * includes <jserrorhandler/ErrorUtils.h>. Targets that build the cxxreact
 * Clang module (react-native-nitro-modules, used by MMKV/Unistyles) can't
 * resolve that header, failing with "'jserrorhandler/ErrorUtils.h' file not
 * found". Upstream hasn't settled whether the fix belongs in Nitro or in
 * React Native's podspecs.
 *
 * A Clang module is built with the importer's header search paths, so the
 * path has to be added to every pod target, not just NitroModules. Adding
 * only the jserrorhandler framework headers isn't enough: the cxxreact module
 * also pulls in jsinspector-modern and others. As in the issue, we add React
 * Native's whole ReactCommon folder, resolved from the Podfile's
 * reactNativePath because react-native is hoisted in this monorepo.
 *
 * Remove this plugin once the issue is fixed upstream.
 */
const POST_INSTALL_SNIPPET = `
    react_common = File.expand_path(
      File.join(config[:reactNativePath], 'ReactCommon'),
      Pod::Config.instance.installation_root
    )
    react_common_path = "\\"#{react_common}\\""
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_configuration|
        paths = build_configuration.build_settings['HEADER_SEARCH_PATHS'] || ['$(inherited)']
        paths = paths.split(' ') if paths.is_a?(String)
        unless paths.include?(react_common_path)
          build_configuration.build_settings['HEADER_SEARCH_PATHS'] = paths + [react_common_path]
        end
      end
    end`;

module.exports = function withJsErrorHandlerHeaders(config) {
  return withPodfile(config, (podfileConfig) => {
    const result = mergeContents({
      tag: "cookclub-jserrorhandler-headers",
      src: podfileConfig.modResults.contents,
      newSrc: POST_INSTALL_SNIPPET,
      anchor: /post_install do \|installer\|/,
      offset: 1,
      comment: "#",
    });

    if (!result.didMerge && !result.didClear) {
      throw new Error(
        "withJsErrorHandlerHeaders: could not find post_install in the Podfile",
      );
    }

    podfileConfig.modResults.contents = result.contents;
    return podfileConfig;
  });
};
