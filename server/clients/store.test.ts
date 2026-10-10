import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { getProjectClients, groupProjectsByClient, parseClientInput, setProjectClient } from "./store.js";

describe("groupProjectsByClient", () => {
  it("groups projects under their client, sorted by client then project", () => {
    expect(
      groupProjectsByClient({
        venues: "Firefly",
        consus: "pantheon",
        flayr: "Firefly",
        auriga: "pantheon",
        scratch: null,
      }),
    ).toEqual({
      clients: [
        { name: "Firefly", projects: ["flayr", "venues"] },
        { name: "pantheon", projects: ["auriga", "consus"] },
      ],
      ungrouped: ["scratch"],
    });
  });

  it("keeps every project ungrouped when no client is set", () => {
    expect(groupProjectsByClient({ a: null, b: null })).toEqual({ clients: [], ungrouped: ["a", "b"] });
  });

  it("handles an empty registry", () => {
    expect(groupProjectsByClient({})).toEqual({ clients: [], ungrouped: [] });
  });
});

describe("parseClientInput", () => {
  it("trims a string and clears on null or blank", () => {
    expect(parseClientInput("  Firefly ")).toBe("Firefly");
    expect(parseClientInput(null)).toBeNull();
    expect(parseClientInput("   ")).toBeNull();
  });

  it("rejects non-strings and over-long names", () => {
    expect(parseClientInput(42)).toBeUndefined();
    expect(parseClientInput({})).toBeUndefined();
    expect(parseClientInput("x".repeat(81))).toBeUndefined();
  });
});

describe("project client persistence", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  it("sets, overwrites, and clears a project's client", () => {
    setProjectClient(db, "flayr", "Firefly");
    setProjectClient(db, "consus", "Pantheon");
    setProjectClient(db, "consus", "Personal");
    expect(getProjectClients(db, ["flayr", "consus", "vesta"])).toEqual({
      flayr: "Firefly",
      consus: "Personal",
      vesta: null,
    });

    setProjectClient(db, "flayr", null);
    expect(getProjectClients(db, ["flayr"])).toEqual({ flayr: null });
  });

  it("only reports registered projects", () => {
    setProjectClient(db, "gone", "Firefly");
    expect(getProjectClients(db, ["flayr"])).toEqual({ flayr: null });
  });
});
