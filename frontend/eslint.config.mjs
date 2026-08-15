import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

// eslint-config-next enables only six jsx-a11y rules, all of the "don't write
// malformed ARIA" kind. The ones that catch real barriers — labels without
// controls, click handlers on non-interactive elements, mouse handlers with no
// keyboard equivalent — are off by default. The plugin is already registered by
// eslint-config-next, so the rules are switched on by name rather than by
// spreading its flat config (which would try to redefine the plugin).
const a11yRules = Object.fromEntries(
  Object.entries(jsxA11y.flatConfigs.recommended.rules).filter(
    ([, level]) => (Array.isArray(level) ? level[0] : level) !== "off",
  ),
);

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      ...a11yRules,
      // An error, not a warning. When the message list was accidentally
      // deleted from the chat, the only trace left in the build output was
      // two unused-import warnings — which nothing fails on, so nobody saw
      // them. A symbol that stops being used is evidence something was
      // removed, and that is worth stopping for.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
