# Vendored dependencies

## highlight.js

- **File:** `vendor/highlight.min.js`
- **Version:** 11.11.1 (common-languages browser build)
- **Source:** https://unpkg.com/@highlightjs/cdn-assets@11.11.1/highlight.min.js
- **Downloaded:** 2026-08-31
- **License:** BSD-3-Clause (https://github.com/highlightjs/highlight.js/blob/main/LICENSE)

### Included languages

bash, c, cpp, csharp, css, diff, go, graphql, ini, java, javascript, json,
kotlin, less, lua, makefile, markdown, objectivec, perl, php, php-template,
plaintext, python, python-repl, r, ruby, rust, scss, shell, sql, swift,
typescript, vbnet, wasm, xml, yaml

(Obtained via `node -e "console.log(require('./vendor/highlight.min.js').listLanguages())"`.)

Note: `powershell` is not in this build, so `.ps1` files fall back to plain text.

### How to update

1. Download the new common-languages build to the same path:
   `curl -o vendor/highlight.min.js https://unpkg.com/@highlightjs/cdn-assets@<version>/highlight.min.js`
2. Update the version, date, and language list in this file
   (re-run the `listLanguages()` one-liner above).
3. Run the build so the page picks up the new script, and run
   `node --test test/` — the tests verify every `HL_EXT_MAP` language id
   still exists in the build.
