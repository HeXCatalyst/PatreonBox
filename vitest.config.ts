import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Everything under test is pure TS — no DOM environment needed, which
    // keeps the suite fast and avoids a jsdom dependency.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
