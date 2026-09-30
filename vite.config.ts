import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` serves the UI with hot reload; API calls go to `wrangler dev`.
    proxy: { "/api": "http://localhost:8787" },
  },
  test: {
    // `npm run bench` swaps the unit tests for the benchmark file.
    include: process.env.BENCH ? ["bench/**/*.bench.ts"] : ["test/**/*.test.ts"],
  },
});
