import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: true,
    pool: "threads",
    reporters: ["default"],
    testTimeout: 15_000,
  },
});
