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
// The npm "overrides" entry in package.json handles the install-time
// peer-dep gap. Both pieces should be removed once jsx-a11y publishes a
// release that declares ESLint 10 support.
const a11yConfig = fixupConfigRules(jsxA11y.flatConfigs.recommended);

const randomUuid = {
  object: "crypto",
  property: "randomUUID",
  message:
    "Secure contexts only, so the app would not start over plain http; use newId from @/lib/id.",
};

const STORAGE = ["localStorage", "sessionStorage", "indexedDB"];
const STORAGE_MESSAGE =
  "Storage goes through the modules that name it in src/lib/profile/names.ts: @/profile/local for localStorage, the openers for IndexedDB.";
const storageGlobals = STORAGE.map((name) => ({ name, message: STORAGE_MESSAGE }));
const storageProperties = ["window", "globalThis", "self"].flatMap((object) =>
  STORAGE.map((property) => ({ object, property, message: STORAGE_MESSAGE })),
);
const PERSIST_OPTIONS = "CallExpression[callee.name='persist'] > ObjectExpression";

export default defineConfig([
  globalIgnores([
    "dist",
    "dev-dist",
    "mcp",
    "working-docs",
    ".playwright-mcp",
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
      "no-restricted-properties": ["error", randomUuid],
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
  {
    // What this browser keeps is named in src/lib/profile/names.ts and reached
    // through these files alone. Flat config keeps the last matching block's
    // options for a rule, so the pure-module block below repeats them.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/**/*.test.ts",
      "src/profile/local.ts",
      "src/profile/boot.ts",
      "src/lib/idbStorage.ts",
      "src/lib/idbListDb.ts",
      "src/lib/thumbnailCache.ts",
      "src/inputs/db.ts",
      "src/api/dicts.worker.ts",
    ],
    rules: {
      "no-restricted-globals": ["error", ...storageGlobals],
      "no-restricted-properties": ["error", randomUuid, ...storageProperties],
      "no-restricted-syntax": [
        "error",
        {
          selector: `${PERSIST_OPTIONS}:not(:has(> Property[key.name='storage']))`,
          message:
            "A store kept in localStorage persists through persistLocal from @/profile/local; one in IndexedDB names its gated storage.",
        },
        {
          selector: `${PERSIST_OPTIONS} > Property[key.name='name'] > :matches(Literal, TemplateLiteral)`,
          message: "A persisted store takes its name from src/lib/profile/names.ts.",
        },
      ],
    },
  },
  {
    // The boot module runs before the app: nothing it imports may create a store.
    files: ["src/main.tsx", "src/profile/boot.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/stores/*", "@/components/*", "@/hooks/*", "@/api/*", "react", "react-dom"],
              allowTypeImports: true,
              message: "The boot module runs before any store exists.",
            },
          ],
        },
      ],
    },
  },
  {
    // Pure modules: values in, values out. They run in the node test
    // environment, so nothing here may reach a store, React or the DOM.
    files: [
      "src/lib/dicts/**/*.ts",
      "src/lib/gallery/**/*.ts",
      "src/lib/inputs/**/*.ts",
      "src/lib/lut.ts",
      "src/lib/jobs/**/*.ts",
      "src/lib/media/**/*.ts",
      "src/lib/profile/**/*.ts",
      "src/lib/recipes/**/*.ts",
      "src/lib/request/generateParams.ts",
      "src/lib/request/fitNote.ts",
      "src/lib/request/inputPlan.ts",
      "src/lib/request/refusal.ts",
      "src/lib/request/restoreParams.ts",
      "src/lib/request/wire.ts",
      "src/lib/resultStrip.ts",
      "src/lib/trim.ts",
      "src/lib/viewport/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/stores/*",
                "@/hooks/*",
                "@/components/*",
                "@/canvas/*",
                "@/inputs/*",
                "@/profile/*",
                "@/api/client",
                "react",
                "react-dom",
                "react-konva",
                "konva",
                "zustand",
                "zustand/*",
                "@tanstack/*",
                "sonner",
              ],
              allowTypeImports: true,
              message: "Pure modules take what they need as arguments.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...[
          "window",
          "document",
          "navigator",
          "localStorage",
          "sessionStorage",
          "indexedDB",
          "fetch",
          "Image",
          "createImageBitmap",
          "OffscreenCanvas",
          "matchMedia",
          "requestAnimationFrame",
          "cancelAnimationFrame",
          "performance",
          "getComputedStyle",
          "WheelEvent",
          "PointerEvent",
        ].map((name) => ({ name, message: "Pure modules do not touch the browser." })),
      ],
      "no-restricted-properties": [
        "error",
        { object: "URL", property: "createObjectURL", message: "Object URLs belong to media." },
        { object: "URL", property: "revokeObjectURL", message: "Object URLs belong to media." },
        randomUuid,
        ...storageProperties,
      ],
    },
  },
  prettier,
]);
