import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // Only needed to compile JSX in component tests (*.test.tsx). The React plugin
  // does not change how the app is built - Next/Turbopack owns that - and the
  // node-environment tests below are unaffected by it.
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throws outside a bundler; stub it for unit tests.
      "server-only": path.resolve(__dirname, "test/empty.ts"),
    },
  },
  test: {
    // Node stays the DEFAULT: the 16 existing suites are pure logic and do not
    // want a DOM. Component tests opt in per file with a
    // `// @vitest-environment jsdom` docblock, so adding one cannot slow down or
    // change the behaviour of the rest.
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**"],
    env: {
      // lib/stripe/server.ts fails closed on a missing key at module load, so a
      // test that imports anything touching it needs these present. Unit tests
      // never reach Stripe - the client is mocked - so placeholders are enough.
      STRIPE_SECRET_KEY: "sk_test_placeholder",
      STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    },
  },
});
