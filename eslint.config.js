/* eslint-disable @typescript-eslint/no-deprecated -- tseslint.config() is the only way to use extends; core defineConfig has incompatible API */
import { includeIgnoreFile } from "@eslint/config-helpers";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = tseslint.config({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  },
});

const reactConfig = tseslint.config({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [pluginReact.configs.flat.recommended],
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  plugins: {
    "react-hooks": eslintPluginReactHooks,
    "react-compiler": reactCompiler,
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...eslintPluginReactHooks.configs.recommended.rules,
    "react/react-in-jsx-scope": "off",
    "react-compiler/react-compiler": "error",
  },
});

const e2eConfig = tseslint.config({
  // Playwright fixtures name their callback parameter `use`, which eslint-plugin-react-hooks
  // otherwise misidentifies as a React hook call. These files contain no React components.
  files: ["tests/e2e/**/*.ts"],
  rules: {
    "react-hooks/rules-of-hooks": "off",
    "react-compiler/react-compiler": "off",
  },
});

const astroConfig = tseslint.config({
  files: ["**/*.astro"],
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    // Project standardizes on cn() from @/lib/utils in .astro and .tsx alike
    // for tailwind-merge conflict resolution; class:list lacks it. See AGENTS.md.
    "astro/prefer-class-list-directive": "off",
    // astro-eslint-parser gives frontmatter a Program-level context with no enclosing
    // function; no-misused-promises null-derefs (crashes, not a normal lint error) when
    // it walks up from any top-level return statement, e.g. `return Astro.redirect(...)`.
    "@typescript-eslint/no-misused-promises": "off",
  },
});

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  { ignores: ["src/lib/database.types.ts"] },
  baseConfig,
  reactConfig,
  e2eConfig,
  eslintPluginAstro.configs["flat/recommended"],
  ...eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  // astro-eslint-parser does not support projectService; fall back to project: true for .astro files
  {
    files: ["**/*.astro"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  eslintPluginPrettier,
);
