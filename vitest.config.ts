import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throws outside a bundler; stub it for unit tests.
      "server-only": path.resolve(__dirname, "test/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
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
