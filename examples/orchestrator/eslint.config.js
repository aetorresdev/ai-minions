// ESLint 9 flat config — CommonJS project
const js = require("@eslint/js");

module.exports = [
  js.configs.recommended,
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
];
