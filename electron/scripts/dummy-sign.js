/**
 * dummy-sign.js - Custom signing script override for electron-builder
 * Replaces winCodeSign with a no-op so Windows doesn't try to extract
 * macOS symlinks from winCodeSign 7z archives without Developer Mode.
 */
exports.default = async function () {
  return true;
};
