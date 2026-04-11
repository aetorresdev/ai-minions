import js from "/tmp/eslint-tmp/node_modules/@eslint/js/src/index.js";
export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    rules: { "no-unused-vars": "warn", "no-undef": "warn" },
    languageOptions: {
      ecmaVersion: 2022, sourceType: "module",
      globals: {
        process:"readonly", console:"readonly", Buffer:"readonly",
        setTimeout:"readonly", clearTimeout:"readonly",
        __dirname:"readonly", __filename:"readonly",
        require:"readonly", module:"readonly", exports:"readonly",
        URL:"readonly", fetch:"readonly"
      }
    }
  }
];
