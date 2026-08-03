const { IOSConfig, withFinalizedMod } = require("@expo/config-plugins");
const withShareIntent = require("expo-share-intent/app.plugin").default;
const { writeFile } = require("node:fs/promises");

/**
 * expo-share-intent currently creates its extension for both iPhone and iPad.
 * Keep the generated extension aligned with the iPhone-only host application.
 */
module.exports = function withShareExtensionReleaseSettings(config, options) {
  const configWithShareIntent = withShareIntent(config, options);
  const deploymentTarget = config.ios?.deploymentTarget ?? "16.4";
  const targetDeviceFamily = config.ios?.supportsTablet ? '"1,2"' : '"1"';

  return withFinalizedMod(configWithShareIntent, [
    "ios",
    async (configWithProject) => {
      const projectRoot = configWithProject.modRequest.projectRoot;
      const projectPath = IOSConfig.Paths.getPBXProjectPath(projectRoot);
      const project = IOSConfig.XcodeUtils.getPbxproj(projectRoot);
      const configurations = project.pbxXCBuildConfigurationSection();

      for (const entry of Object.values(configurations)) {
        const buildSettings = entry?.buildSettings;
        if (!buildSettings) continue;

        if (buildSettings.PRODUCT_NAME === '"ShareExtension"') {
          buildSettings.IPHONEOS_DEPLOYMENT_TARGET = deploymentTarget;
          buildSettings.TARGETED_DEVICE_FAMILY = targetDeviceFamily;
        }
      }

      await writeFile(projectPath, project.writeSync());
      return configWithProject;
    },
  ]);
};
