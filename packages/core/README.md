# @flexova/core

Read, write, validate and sign Flexova (`.flexova`) documents. It runs in browsers, native WebViews and Node, has two small dependencies, and makes no network requests.

```js
import { write, validate, read, sign, verify, compileTokens } from "@flexova/core";

const bytes = await write({
  identifier: "urn:uuid:…",
  title: "Field manual",
  language: "en",
  modified: "2026-11-02T00:00:00Z",
  chapters: [{ title: "Start", body: '<section><h1 id="start">Start</h1><p>Hello.</p></section>' }],
});

const report = await validate(bytes); // { valid, issues: [{ code, severity, path, message }], codes }
const doc = await read(bytes); // throws FlexovaError if invalid
```

| Function                                                 | What it does                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `write(input)`                                           | Build a package. The output is deterministic: identical input gives identical bytes. It refuses to return anything that does not validate. |
| `validate(bytes)`                                        | Check every rule of the specification. Results use the shared error codes, identical to the Python implementation.                         |
| `read(bytes)`                                            | Validate, then open a package: entries, spine, items, tokens.                                                                              |
| `unpack(bytes)` / `pack(entries)`                        | Safe ZIP extraction (with limits, path checks and bomb protection), and deterministic re-packing.                                          |
| `sign(bytes, privateJwk)` / `verify(bytes, trustedKeys)` | Ed25519 signatures over the manifest (spec section 11), using WebCrypto.                                                                   |
| `generateSigningKey()` / `jwkThumbprint(jwk)`            | Key generation, and the default key ID (RFC 7638).                                                                                         |
| `compileTokens(tokens)`                                  | Theme tokens to CSS with light and dark variants.                                                                                          |

## License

Apache-2.0
