import tsparser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
    globalIgnores([
        "node_modules",
        "dist",
        "esbuild.config.mjs",
        "eslint.config.js",
        "version-bump.mjs",
        "versions.json",
        "main.js",
    ]),
    ...obsidianmd.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: { project: "./tsconfig.json" },
            globals: {
                ...globals.browser,
                ...globals.node, // Adding node globals too just in case, though browser is usually enough for obsidian plugins
            },
        },

        // You can add your own configuration to override or add rules
        rules: {
            // example: turn off a rule from the recommended set
            "obsidianmd/sample-names": "off",
            // example: add a rule not in the recommended set and set its severity
            // "obsidianmd/prefer-file-manager-trash": "error",
        },
    },
]);
