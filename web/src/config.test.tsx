import { describe, it, expect } from "vitest";
import { API_BASE_URL } from "./config";

describe("API_BASE_URL", () => {
  it("Given no VITE_API_BASE_URL override, defaults to a same-origin relative path (routed via the Vite dev proxy to :8722, avoiding CORS)", () => {
    expect(API_BASE_URL).toBe("");
  });
});
