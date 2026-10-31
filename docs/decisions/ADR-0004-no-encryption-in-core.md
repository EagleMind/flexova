# ADR-0004: No encryption in the core format

- **Status:** Accepted, 2026-10-31.

## Context

Encryption only helps when **protection must travel with the file**: confidential documents emailed or handed to individuals, or files on unmanaged offline devices. It is not needed for:

- public documents;
- documents inside systems that already control access (intranets, Drive/SharePoint, apps that embed Flexova);
- managed devices with OS encryption.

Building encryption into the core would hurt the format:

- **Integration:** every implementation would need crypto and key handling.
- **Readability:** static, no-JS reading would be gone.
- **Tooling:** previews, search indexing, data-loss-prevention scanning, accessibility tools and AI ingestion all need plaintext.
- **Reputation:** an HTML file that asks for a secret resembles HTML smuggling, which mail gateways quarantine.
- **Support:** a lost key means a lost document.

## Decision

- **Core Flexova has no encryption.** Signatures are optional (ADR-0011).
- **Flexova Seal** is a separate, optional extension spec (milestone M8): an encrypted envelope around an ordinary Flexova package. Viewers without Seal support show "This document is sealed; open it in FlexPad."
- **Controlled access** (revocation, expiry, audit, watermarking) is **not a format feature.** It is an optional FlexPad/server capability, because it needs a network.
- **Protection levels** are named honestly:
  - L0 Public (signed or plain);
  - L1 Sealed (passphrase or recipient keys, offline, no revocation);
  - L2 Controlled (key server).

  The UI says "Sealed", never "Secure", and never claims copying is disabled.

## Consequences

- **Simple integration:** integrators can ignore encryption entirely.
- **Offline confidentiality is still possible** through Seal, the only real mechanism when there's no server.
- **Stated limits:** an authorized reader can always copy content, and offline documents can't be revoked or made to expire. SECURITY.md says so.
