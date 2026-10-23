"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeShareExtensionFiles = writeShareExtensionFiles;
exports.getShareExtensionEntitlementsFilePath = getShareExtensionEntitlementsFilePath;
exports.getShareExtensionEntitlements = getShareExtensionEntitlements;
exports.getShareExtensionEntitlementsContent = getShareExtensionEntitlementsContent;
exports.getShareExtensionInfoFilePath = getShareExtensionInfoFilePath;
exports.getShareExtensionInfoContent = getShareExtensionInfoContent;
exports.getPrivacyInfoFilePath = getPrivacyInfoFilePath;
exports.getPrivacyInfoContent = getPrivacyInfoContent;
exports.getShareExtensionStoryboardFilePath = getShareExtensionStoryboardFilePath;
exports.getShareExtensionStoryBoardContent = getShareExtensionStoryBoardContent;
exports.getShareExtensionViewControllerPath = getShareExtensionViewControllerPath;
exports.getPreprocessorFilePath = getPreprocessorFilePath;
exports.getPreprocessorContent = getPreprocessorContent;
exports.getShareExtensionViewControllerContent = getShareExtensionViewControllerContent;
const plist_1 = __importDefault(require("@expo/plist"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const constants_1 = require("./constants");
async function writeShareExtensionFiles(platformProjectRoot, scheme, appIdentifier, parameters, appName) {
    // ShareExtension-Info.plist
    const infoPlistFilePath = getShareExtensionInfoFilePath(platformProjectRoot, parameters);
    const infoPlistContent = getShareExtensionInfoContent(appName, appIdentifier, parameters);
    await node_fs_1.default.promises.mkdir(node_path_1.default.dirname(infoPlistFilePath), { recursive: true });
    await node_fs_1.default.promises.writeFile(infoPlistFilePath, infoPlistContent);
    // ShareExtension.entitlements
    const entitlementsFilePath = getShareExtensionEntitlementsFilePath(platformProjectRoot, parameters);
    const entitlementsContent = getShareExtensionEntitlementsContent(appIdentifier, parameters);
    await node_fs_1.default.promises.writeFile(entitlementsFilePath, entitlementsContent);
    // PrivacyInfo.xcprivacy
    const pricayFilePath = getPrivacyInfoFilePath(platformProjectRoot, parameters);
    const pricayContent = getPrivacyInfoContent();
    await node_fs_1.default.promises.writeFile(pricayFilePath, pricayContent);
    // MainInterface.storyboard
    const storyboardFilePath = getShareExtensionStoryboardFilePath(platformProjectRoot, parameters);
    const storyboardContent = getShareExtensionStoryBoardContent();
    await node_fs_1.default.promises.writeFile(storyboardFilePath, storyboardContent);
    // ShareViewController.swift
    const viewControllerFilePath = getShareExtensionViewControllerPath(platformProjectRoot, parameters);
    const viewControllerContent = getShareExtensionViewControllerContent(scheme, (0, constants_1.getAppGroup)(appIdentifier, parameters));
    await node_fs_1.default.promises.writeFile(viewControllerFilePath, viewControllerContent);
    // ShareExtensionPreprocessor.js
    const preprocessorFilePath = getPreprocessorFilePath(platformProjectRoot, parameters);
    const preprocessorContent = getPreprocessorContent(parameters);
    await node_fs_1.default.promises.writeFile(preprocessorFilePath, preprocessorContent);
}
//: [root]/ios/ShareExtension/ShareExtension.entitlements
function getShareExtensionEntitlementsFilePath(platformProjectRoot, parameters) {
    return node_path_1.default.join(platformProjectRoot, (0, constants_1.getShareExtensionName)(parameters), constants_1.shareExtensionEntitlementsFileName);
}
function getShareExtensionEntitlements(appIdentifier, parameters) {
    return {
        "com.apple.security.application-groups": [
            (0, constants_1.getAppGroup)(appIdentifier, parameters),
        ],
    };
}
function getShareExtensionEntitlementsContent(appIdentifier, parameters) {
    return plist_1.default.build(getShareExtensionEntitlements(appIdentifier, parameters));
}
//: [root]/ios/ShareExtension/ShareExtension-Info.plist
function getShareExtensionInfoFilePath(platformProjectRoot, parameters) {
    return node_path_1.default.join(platformProjectRoot, (0, constants_1.getShareExtensionName)(parameters), constants_1.shareExtensionInfoFileName);
}
function getShareExtensionInfoContent(appName, appIdentifier, parameters) {
    return plist_1.default.build({
        CFBundleName: "$(PRODUCT_NAME)",
        // Arth patch: the name shown in the share sheet can differ from the extension's target name,
        // which mustn't equal the app's own target ("Arth") or the extension is never created.
        CFBundleDisplayName: parameters.iosShareExtensionDisplayName || parameters.iosShareExtensionName || `${appName} - Share Extension`,
        CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
        CFBundleDevelopmentRegion: "$(DEVELOPMENT_LANGUAGE)",
        CFBundleExecutable: "$(EXECUTABLE_NAME)",
        CFBundleInfoDictionaryVersion: "6.0",
        CFBundlePackageType: "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
        NSExtension: {
            NSExtensionAttributes: {
                NSExtensionActivationRule: parameters.iosActivationRules || {
                    NSExtensionActivationSupportsWebURLWithMaxCount: 1,
                    NSExtensionActivationSupportsWebPageWithMaxCount: 1,
                },
                NSExtensionJavaScriptPreprocessingFile: "ShareExtensionPreprocessor",
            },
            NSExtensionMainStoryboard: "MainInterface",
            NSExtensionPointIdentifier: "com.apple.share-services",
        },
        // use in ExpoShareIntentModule.swift
        AppGroupIdentifier: (0, constants_1.getAppGroup)(appIdentifier, parameters),
    });
}
//: [root]/ios/ShareExtension/PrivacyInfo.xcprivacy
function getPrivacyInfoFilePath(platformProjectRoot, parameters) {
    return node_path_1.default.join(platformProjectRoot, (0, constants_1.getShareExtensionName)(parameters), "PrivacyInfo.xcprivacy");
}
function getPrivacyInfoContent() {
    return plist_1.default.build({
        NSPrivacyAccessedAPITypes: [
            {
                NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
                NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
            },
        ],
        NSPrivacyCollectedDataTypes: [],
        NSPrivacyTracking: false,
    });
}
//: [root]/ios/ShareExtension/MainInterface.storyboard
function getShareExtensionStoryboardFilePath(platformProjectRoot, parameters) {
    return node_path_1.default.join(platformProjectRoot, (0, constants_1.getShareExtensionName)(parameters), constants_1.shareExtensionStoryBoardFileName);
}
function getShareExtensionStoryBoardContent() {
    return `<?xml version="1.0" encoding="UTF-8"?>
  <document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="13122.16" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="j1y-V4-xli">
      <dependencies>
          <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="13104.12"/>
          <capability name="Safe area layout guides" minToolsVersion="9.0"/>
          <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
      </dependencies>
      <scenes>
          <!--Share View Controller-->
          <scene sceneID="ceB-am-kn3">
              <objects>
                  <viewController id="j1y-V4-xli" customClass="ShareViewController" customModuleProvider="target" sceneMemberID="viewController">
                      <view key="view" opaque="NO" contentMode="scaleToFill" id="wbc-yd-nQP">
                          <rect key="frame" x="0.0" y="0.0" width="375" height="667"/>
                          <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                          <color key="backgroundColor" red="0.0" green="0.0" blue="0.0" alpha="0.0" colorSpace="custom" customColorSpace="sRGB"/>
                          <viewLayoutGuide key="safeArea" id="1Xd-am-t49"/>
                      </view>
                  </viewController>
                  <placeholder placeholderIdentifier="IBFirstResponder" id="CEy-Cv-SGf" userLabel="First Responder" sceneMemberID="firstResponder"/>
              </objects>
          </scene>
      </scenes>
  </document>
  `;
}
//: [root]/ios/ShareExtension/ShareViewController.swift
function getShareExtensionViewControllerPath(platformProjectRoot, parameters) {
    return node_path_1.default.join(platformProjectRoot, (0, constants_1.getShareExtensionName)(parameters), constants_1.shareExtensionViewControllerFileName);
}
function getPreprocessorFilePath(platformProjectRoot, parameters) {
    return node_path_1.default.join(platformProjectRoot, (0, constants_1.getShareExtensionName)(parameters), constants_1.shareExtensionPreprocessorFileName);
}
function getPreprocessorContent(parameters) {
    const injection = parameters.preprocessorInjectJS || "";
    return `class ShareExtensionPreprocessor {
  run({ completionFunction }) {
    // Extract meta tags and image sources from the document
    const metas = {
      title: document.title,
    };

    // Get all meta elements
    const metaElements = document.querySelectorAll("meta");
    for (const meta of metaElements) {
      const name = meta.getAttribute("name") || meta.getAttribute("property");
      const content = meta.getAttribute("content");

      if (name && content) {
        metas[name] = content;
      }
    }

    ${injection}

    // Call the completion function with the extracted data
    completionFunction({
      baseURI: document.baseURI,
      meta: JSON.stringify(metas),
    });
  }
}
var ExtensionPreprocessingJS = new ShareExtensionPreprocessor();
`;
}
function getShareExtensionViewControllerContent(scheme, groupIdentifier) {
    let updatedScheme = scheme;
    if (Array.isArray(scheme)) {
        console.warn(`[expo-share-intent] multiple scheme detected (${scheme.join(",")}), using:${updatedScheme}`);
        updatedScheme = scheme[0];
    }
    console.warn(`[expo-share-intent] add ios share extension (scheme:${updatedScheme} groupIdentifier:${groupIdentifier})`);
    if (!updatedScheme) {
        throw new Error("[expo-share-intent] missing custom URL scheme 'expo.scheme' in app.json ! (see https://docs.expo.dev/guides/linking/#linking-to-your-app)");
    }
    const content = node_fs_1.default.readFileSync(node_path_1.default.resolve(__dirname, "./ShareExtensionViewController.swift"), "utf8");
    return content
        .replaceAll("<SCHEME>", updatedScheme)
        .replaceAll("<GROUPIDENTIFIER>", groupIdentifier);
}
