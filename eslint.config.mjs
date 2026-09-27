// Obsidian's own lint rules, the ones its review bot applies to community
// plugins. Run with `npm run lint` (also part of `npm test`).
import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  globalIgnores(['main.js', 'node_modules/', 'test/', 'scripts/', 'build.js', 'eslint.config.mjs']),
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.*'],
        },
      },
    },
    rules: {
      'obsidianmd/ui/sentence-case': ['warn', {
        brands: ['calibre', 'Piper', 'Obsidian', 'Windows', 'macOS', 'Linux', 'Flatpak'],
      }],
      // src/package.json only marks src as ES modules; the dependencies are
      // in the root package.json.
      'import/no-extraneous-dependencies': ['error', { packageDir: [import.meta.dirname] }],
    },
  },
]);
