# @flexova/cli

The `flexova` command builds Flexova (`.flexova`) documents from Markdown, DOCX and other formats. It also checks, inspects, signs and verifies them, and exports static HTML or EPUB. It needs Node 22.18 or later.

```bash
npx @flexova/cli new manual
```

```bash
npx @flexova/cli build manual --html
```

| Command                                                   | What it does                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new <folder>`                                            | Start a Markdown project with a `flexova.config.json`                                                                                                                                                                         |
| `build <input>`                                           | Build from a project folder, a Markdown file, or anything Pandoc reads (`.docx`, `.odt`, `.html`, `.tex`, `.rst`, …). `--html` also writes a static page; `--sign key.jwk` signs the result; `--strict` stops on any warning. |
| `check <file>…`                                           | Validate packages and list every issue with its code (`--json` for machines)                                                                                                                                                  |
| `inspect <file>`                                          | Show the title, language, chapters, assets and signature                                                                                                                                                                      |
| `pack --html <file>`                                      | Write a static, script-free `.flexova.html` that needs no network                                                                                                                                                             |
| `pack <folder>` / `unpack <file>`                         | Zip an unpacked package folder, or extract a `.flexova` or `.flexova.html`                                                                                                                                                    |
| `export --epub <file>`                                    | Copy to `.epub` for EPUB readers (an unsigned Flexova package is valid EPUB 3.3)                                                                                                                                              |
| `keygen [name]`                                           | Create an Ed25519 key pair: a private JWK and a JWKS to publish                                                                                                                                                               |
| `sign <file> --key <jwk>` / `verify <file> --keys <jwks>` | Sign a package, or check its signature against trusted keys                                                                                                                                                                   |

**Exit codes:**

- `0` success;
- `1` invalid package, failed verification, or warnings with `--strict`;
- `2` usage error;
- `3` a required tool is missing, such as Pandoc for `.docx`.

**Reproducible builds:** the same input gives byte-identical output. When `flexova.config.json` has no `identifier`, one is derived from the input. The modification time comes from `--modified`, the config, or `SOURCE_DATE_EPOCH`.

**Converting DOCX** needs [Pandoc](https://pandoc.org/installing.html) 2.11 or later. The `ghcr.io/eaglemind/flexova-cli` Docker image includes it. Word paragraph styles named Note, Tip, Important, Warning or Caution become callouts. Map others with `--style "Hinweis=note"`.

## License

Apache-2.0
