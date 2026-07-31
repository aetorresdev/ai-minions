// ESLint flat config — CommonJS project
const js = require("@eslint/js");

module.exports = [
  js.configs.recommended,
  {
    // no-useless-assignment and preserve-caught-error are new in the ESLint 10 recommended
    // set; the security-driven major bump must not change lint gate semantics for
    // pre-existing code. Enable and clean up in a dedicated lint-hygiene pass.
    rules: {
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
    },
  },
  {
    files: ["**/*.js"],
    ignores: ["node_modules/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require:      "readonly",
        module:       "readonly",
        exports:      "readonly",
        __dirname:    "readonly",
        __filename:   "readonly",
        process:      "readonly",
        console:      "readonly",
        Buffer:       "readonly",
        setTimeout:   "readonly",
        clearTimeout: "readonly",
        URL:          "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console":     "off",
      "no-undef":       "error",
      "no-var":         "error",
      "prefer-const":   "warn",
    },
  },
  {
    files: ["**/*.mjs"],
    ignores: ["node_modules/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process:      "readonly",
        console:      "readonly",
        Buffer:       "readonly",
        setTimeout:   "readonly",
        clearTimeout: "readonly",
        URL:          "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console":     "off",
      "no-undef":       "error",
      "no-var":         "error",
      "prefer-const":   "warn",
    },
  },
  {
    files: ["**/*.cjs"],
    ignores: ["node_modules/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require:      "readonly",
        module:       "readonly",
        exports:      "readonly",
        __dirname:    "readonly",
        __filename:   "readonly",
        process:      "readonly",
        console:      "readonly",
        Buffer:       "readonly",
        URL:          "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console":     "off",
      "no-undef":       "error",
      "no-var":         "error",
      "prefer-const":   "warn",
    },
  },
];
