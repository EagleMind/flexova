# Flexova specification

Licensed under [CC-BY-4.0](LICENSE).

| File                          | Status                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `constants.json`              | ✅ Naming constants: extension, media type, manifest path, viewer element. Every implementation tests against it.                       |
| `flexova-1.0.md`              | Milestone M1: container, content profile, manifest, tokens, metadata, conformance classes                                               |
| `profile/profile-1.0.json`    | Milestone M1: allowed elements, attributes and values, the single source of truth for validators, viewers and the FlexPad editor schema |
| `schema/manifest.schema.json` | Milestone M1: JSON Schema for `META-INF/flexova.json`                                                                                   |

**Rules are data.** Anything an implementation must enforce belongs in a machine-readable file here, not only in prose. A shared conformance suite then checks every implementation against it (see ADR-0008).
