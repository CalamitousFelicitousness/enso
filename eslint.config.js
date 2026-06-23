import js from "@eslint/js";
import { fixupConfigRules } from "@eslint/compat";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";

// jsx-a11y has not released ESLint 10 support (PRs #1081, #1079 stalled
// since Feb 2026). fixupConfigRules wraps each rule through the official
// ESLint-team compat layer so removed v10 context APIs are back-filled.
// pnpm resolves the plugin's eslint peer to the root eslint 10 on its own, so
// no package-manager override is needed. Remove this shim once jsx-a11y
// publishes a release that declares ESLint 10 support.
const a11yConfig = fixupConfigRules(jsxA11y.flatConfigs.recommended);

export default defineConfig([
  globalIgnores([
    "dist",
    "dev-dist",
    "mcp",
    "working-docs",
    "src/lib/*.generated.ts",
    "src/lib/openapi-generated/",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      a11yConfig,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      // Radix-based Checkbox/Switch are the project's native form controls;
      // labels wrap them like any input. Teach the rule about them.
      "jsx-a11y/label-has-associated-control": [
        "error",
        {
          controlComponents: [
            "Checkbox",
            "Switch",
            "RadioGroup",
            "Slider",
            "Combobox",
            "NumberInput",
            "SegmentedControl",
          ],
          assert: "either",
        },
      ],
    },
  },
  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  prettier,
]);
