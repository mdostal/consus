#!/usr/bin/env node
// Preflight: better-sqlite3 (and any other native addon) is compiled against
// a specific NODE_MODULE_VERSION. If the Node binary running the tests has a
// different ABI than the one node-gyp/prebuild-install used, `require()`
// throws a NODE_MODULE_VERSION mismatch error deep inside the DB layer,
// which reads as an opaque failure in 50+ unrelated test files. Fail fast
// here instead, with a message that says exactly what to run.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const runtimeAbi = process.versions.modules;

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const engineRange = pkg.engines?.node;

try {
  const Database = require("better-sqlite3");
  new Database(":memory:").close();
} catch (err) {
  const message = String(err?.message ?? err);
  const abiMismatch = /NODE_MODULE_VERSION/.test(message);

  console.error("\n✗ Native module preflight failed: better-sqlite3 could not be loaded.\n");
  console.error(`  Running Node ${process.version} (NODE_MODULE_VERSION ${runtimeAbi})`);
  if (engineRange) {
    console.error(`  This repo pins Node via "engines.node": "${engineRange}" (see .nvmrc)`);
  }
  if (abiMismatch) {
    console.error(
      "\n  This is an ABI mismatch: better-sqlite3's native binding was built for a\n" +
        "  different Node version than the one currently running.\n" +
        "\n  Fix: switch to the pinned Node version and rebuild the native module:\n" +
        "    nvm use   (or: mise use)\n" +
        "    npm rebuild better-sqlite3\n",
    );
  } else {
    console.error(`\n  Original error:\n  ${message}\n`);
  }
  process.exit(1);
}

process.exit(0);
