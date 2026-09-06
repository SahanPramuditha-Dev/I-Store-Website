"use strict";

const assert = require("node:assert/strict");
const { parseVersion, isNewerVersion } = require("./update-version");

assert.deepEqual(parseVersion("v1.1.105"), [1, 1, 105]);
assert.deepEqual(parseVersion("1.2.0-beta.1"), [1, 2, 0]);
assert.equal(parseVersion("broken"), null);
assert.equal(isNewerVersion("1.1.105", "1.1.104"), true);
assert.equal(isNewerVersion("1.1.100", "1.1.104"), false);
assert.equal(isNewerVersion("1.1.105", "1.1.105"), false);
assert.equal(isNewerVersion("2.0.0", "1.99.99"), true);

console.log("Updater version comparison tests passed.");
