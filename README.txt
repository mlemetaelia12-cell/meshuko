MESHUKO'S FARM — ESLint 9 + Next.js 15 config fix

1. In your project root, replace the existing eslint.config.mjs with the included file.
2. In the same PowerShell terminal, run:

   npm install -D @eslint/eslintrc
   npm run lint

Why: eslint-config-next 15.5.x exposes legacy presets. FlatCompat converts the Next.js presets into an ESLint 9 flat config. Merely adding .js to the import path can lead to a follow-up "nextVitals is not iterable" error.
