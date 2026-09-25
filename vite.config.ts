import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` serves the UI with hot reload; API calls go to `wrangler dev`.
    proxy: { "/api": "http://localhost:8787" },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
