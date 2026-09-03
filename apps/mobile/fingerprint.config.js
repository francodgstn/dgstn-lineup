// apps/mobile/fingerprint.config.js — what the NATIVE fingerprint ignores.
//
// app.config.js sets `runtimeVersion.policy = 'fingerprint'`, so an OTA update
// can only land on a build whose native project hashes the same, and the
// `continuous-deploy-fingerprint` lane (.github/workflows/mobile.yml) decides
// OTA-vs-build by computing that hash on the GitHub runner and comparing it to
// the builds EAS holds. By default @expo/fingerprint hashes the WHOLE expo
// config, `extra` included — and `extra.firebase` differs between the runner
// (no FIREBASE_API_KEY → the demo project) and the EAS build (the real key from
// the EAS environment). Without this file every push would therefore look like
// a native change, trigger a fresh build, and OTA would never be chosen.
//
//   ExpoConfigExtraSection  `extra` carries runtime data, not native config.
//   ExpoConfigVersions      `version` / buildNumber / versionCode: a store
//                           version bump is not a native change, and `store`
//                           auto-increments them on EAS anyway.
//
// `npx @expo/fingerprint apps/mobile` prints the hash + sources to check this.
const { SourceSkips } = require('expo/fingerprint')

module.exports = {
  sourceSkips: SourceSkips.ExpoConfigExtraSection | SourceSkips.ExpoConfigVersions,
}
