#!/usr/bin/env node
import { createProgram } from "../lib/cli.js";

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  if (error.code === "commander.helpDisplayed") {
    process.exit(0);
  }

  console.error(error.message);
  process.exit(1);
}
