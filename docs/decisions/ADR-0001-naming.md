# ADR-0001: Naming

- **Status:** Accepted, 2026-10-31. Trademark and domain checks are pending (owner action, see `docs/STATUS.md`).

## Context

The working name "Flex" collided badly:

- `.flex` is claimed by JFlex in GitHub Linguist and associated with Flexcil, a PDF reader and note-taking app in our exact category.
- `flex` is taken on npm, PyPI and crates.io.
- "Flex-" is crowded in software (Flexera, Twilio Flex, Flex Ltd, Flexsoftware), and "flex" reads as CSS Flexbox to developers.

## Decision

| Item             | Value                                                                             |
| ---------------- | --------------------------------------------------------------------------------- |
| Format           | **Flexova** ("flex" + "nova", new)                                                |
| Extension        | `.flexova` (full name, no short alias)                                            |
| Single-file HTML | `<name>.flexova.html`                                                             |
| Media type       | `application/vnd.flexova+zip` (to be registered in IANA's vendor tree at M6)      |
| Reader/editor    | **FlexPad**                                                                       |
| Packages         | npm `@flexova/*`; `flexova` on PyPI, crates.io, RubyGems and NuGet; CLI `flexova` |
| Web component    | `<flexova-viewer>`                                                                |
| Namespace URI    | placeholder `https://flexova.example/ns/1.0#` until the domain is registered      |

All of these live in `spec/constants.json`, and implementations are tested against it.

## Consequences

- **Long extension.** Seven characters, comparable to Apple's `.numbers` and `.keynote`. It is self-explanatory and collision-free. Three-letter extensions are crowded and poorly tracked.
- **Trademark comparison needed.** Flexova shares the "Flex-" prefix with Flexera, so a trademark attorney should compare the two.
- **The `flexpad` npm name is taken** by a CSS flexbox library. FlexPad packages, if any, use the `@flexova/` scope.

## Evidence

`prototypes/naming/name_check.py` checked about 70 candidates against 3,571 known extensions (Linguist, mime-db, freedesktop, `/etc/mime.types`) and five package registries, followed by web searches.

- **Flexova:** free everywhere checked. No software product found; near-misses only in unrelated classes (Flexove, a drug; Flexinova, foam).
- **Rejected:**
  - Flexum: a rich-text-editor agency.
  - Leaflow: a container-hosting platform.
  - Flexura: too close to Flexera.
  - Flowleaf: sounds like Flyleaf Inc., which holds a software trademark.
  - Flexen, Flexiva, Flexis, Flexile, Flexmark and others.
