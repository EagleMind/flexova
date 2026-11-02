# Flexova

**Flexova** (`.flexova`) is an open document format for reports, manuals and other documents that people read on any screen. It is designed as a better PDF for reading:

- **Reflowable:** text adapts to every screen width, with no pinching or zooming on phones.
- **Light and fast,** and it follows the system's light or dark mode.
- **Accessible by construction:** semantic structure, required alt text, and contrast checked in both themes.
- **Works offline and anywhere:** every asset lives inside the file, and any browser can display it.
- **Easy to integrate:** a Flexova file is a ZIP of strict XHTML and JSON. You can write one with nothing but a language's standard library, and display it with a dependency-free web component of about 7 KB gzipped.

Under the hood, an unencrypted Flexova file is also a valid **EPUB 3.3** package. Encryption is an optional extension (_Flexova Seal_), not part of the core format.

**FlexPad**, the offline-first reader and editor, is developed separately.

> **Status: pre-alpha (milestone M2: viewer and single-file HTML).** The specification and reference implementations are being built in the open. See [`docs/STATUS.md`](docs/STATUS.md) for progress and [`docs/decisions/`](docs/decisions/) for the reasoning behind the design.

## Repository layout

| Path              | Contents                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `spec/`           | The Flexova specification and machine-readable rules (profile, error codes, manifest schema). Licensed CC-BY-4.0. |
| `conformance/`    | The shared conformance suite: 122 fixtures with expected codes, plus golden vectors.                              |
| `packages/core`   | `@flexova/core`: validate, write, read and compile tokens (TypeScript; Node and browsers).                        |
| `packages/viewer` | `@flexova/viewer`: the `<flexova-viewer>` web component (about 7 KB gzipped, no dependencies).                    |
| `packages/html`   | `@flexova/html`: static, script-free, reversible `.flexova.html` pages.                                           |
| `python/`         | `flexova`: a standard-library-only Python writer and validator.                                                   |
| `examples/`       | A plain-HTML reader, plus React and Vue components.                                                               |
| `e2e/`, `bench/`  | Browser tests (three engines in CI) and the 1,000-page benchmark.                                                 |
| `docs/`           | Project status and architecture decision records (ADRs).                                                          |
| `prototypes/`     | Design-phase experiments that proved the architecture (reference only).                                           |

Planned next: `packages/import` and `packages/cli` (`flexova`).

## Development

Requires Node 22.18+ (via corepack), pnpm 10, and Python 3.10+.

```bash
corepack enable
```

```bash
pnpm install
```

```bash
pnpm check
```

`pnpm check` runs lint, format check, build, typecheck, tests and the Python tests, the same steps CI runs.

## License

- Code: [Apache-2.0](LICENSE).
- Specification (`spec/`): [CC-BY-4.0](spec/LICENSE).
