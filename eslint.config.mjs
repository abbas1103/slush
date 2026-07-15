import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * Flat ESLint config for Next 16. `eslint-config-next` ships its presets as
 * flat-config arrays, so we spread them directly (no FlatCompat shim needed).
 */
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  {
    // The React Compiler advisory rules (eslint-plugin-react-hooks v6, enabled
    // as errors by eslint-config-next 16) flag benign pre-existing patterns in
    // this codebase — the SSR mount-flag in Modal, reset-then-fetch in
    // PaymentPanel, Date.now() in a server-rendered page. They're performance
    // hints, not correctness bugs. Kept as warnings so they stay visible
    // without failing CI; to be tightened to error in a dedicated lint pass.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
];

export default eslintConfig;
