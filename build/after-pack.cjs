const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Finder metadata copied into a generated bundle makes codesign reject it.
// Clean only that metadata on the build output; keep quarantine attributes.
module.exports = async ({ electronPlatformName, appOutDir, packager }) => {
  if (electronPlatformName !== 'darwin') return;
  const bundle = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  for (const attribute of ['com.apple.FinderInfo', 'com.apple.ResourceFork']) {
    execFileSync('/usr/bin/xattr', ['-d', '-r', attribute, bundle]);
  }
};
