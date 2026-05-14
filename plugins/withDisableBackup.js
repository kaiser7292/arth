const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin to fully disable Android Auto Backup.
 *
 * On Android 12+ (API 31+), allowBackup=false alone is insufficient.
 * Google's new cloud backup ignores that flag. We must also set
 * dataExtractionRules pointing to an XML that excludes everything.
 */
function withDisableBackup(config) {
  // Step 1: Create the data_extraction_rules.xml file
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const xmlDir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/res/xml"
      );
      fs.mkdirSync(xmlDir, { recursive: true });

      // Exclude everything from both cloud and device-to-device transfer
      const rulesXml = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="file" path="." />
        <exclude domain="external" path="." />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="file" path="." />
        <exclude domain="external" path="." />
    </device-transfer>
</data-extraction-rules>
`;
      fs.writeFileSync(path.join(xmlDir, "data_extraction_rules.xml"), rulesXml);

      // Also create backup_rules.xml for pre-Android 12 (API < 31)
      const backupRulesXml = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <exclude domain="root" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="file" path="." />
    <exclude domain="external" path="." />
</full-backup-content>
`;
      fs.writeFileSync(path.join(xmlDir, "backup_rules.xml"), backupRulesXml);

      return config;
    },
  ]);

  // Step 2: Add attributes to AndroidManifest.xml <application> tag
  config = withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0];
    application.$["android:allowBackup"] = "false";
    application.$["android:fullBackupContent"] = "@xml/backup_rules";
    application.$["android:dataExtractionRules"] = "@xml/data_extraction_rules";
    return config;
  });

  return config;
}

module.exports = withDisableBackup;
