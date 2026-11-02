# Flexova specification

Licensed under [CC-BY-4.0](LICENSE).

| File                          | Status                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `errors.json`                 | ✅ The 59 validation codes with phase, severity and fatality                                                                 |
| `constants.json`              | ✅ Naming constants: extension, media type, manifest path, viewer element. Every implementation tests against it.            |
| `flexova-1.0.md`              | ✅ Draft 0.1: container, content profile, manifest, tokens, validation algorithm, viewer requirements                        |
| `profile/profile-1.0.json`    | ✅ Allowed elements, attributes and values, the single source of truth for validators, viewers and the FlexPad editor schema |
| `schema/manifest.schema.json` | ✅ JSON Schema for `META-INF/flexova.json`                                                                                   |

**Rules are data.** Anything an implementation must enforce belongs in a machine-readable file here, not only in prose. A shared conformance suite then checks every implementation against it (see ADR-0008).
