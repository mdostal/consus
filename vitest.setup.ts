import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL's automatic cleanup relies on detecting a global `afterEach`, which
// isn't present unless `test.globals: true`. This project imports
// describe/it/expect explicitly instead of using globals, so cleanup is
// wired up explicitly here.
afterEach(() => {
  cleanup();
});
