# ADR-0010: FlexPad is offline-first; web app first

- **Status:** Accepted, 2026-10-31. Recorded here because it constrains the SDK; the code lives in the private `flexpad` repository.

## Decision

- **Platform order:** an installable offline web app (PWA) first; then Tauri (desktop) and Capacitor (iOS/Android) wrappers around the same UI (M7), for file associations and storage the OS won't evict.
- **Only three features may require a network:** first unlock of L2 documents, update checks, and sharing.
- **The `.flexova` file is the source of truth.** Browser storage (OPFS/IndexedDB) is only an autosave buffer and recent-documents cache, because Safari can evict website storage. Save through the File System Access API, falling back to download.
- **The editor can't produce an invalid file:** it uses Tiptap/ProseMirror with a schema **generated from `spec/profile/profile-1.0.json`**.
- **Offline import:** Markdown in the browser, and DOCX through mammoth.js in the browser. Pandoc-quality imports go through the CLI or server when online.

## Consequences for this repo

- **`@flexova/core` and `@flexova/viewer` must run in browsers** with no Node APIs (enforced by an ESLint rule) and no network access.
- **The profile JSON must be rich enough to generate an editor schema:** allowed children per element, required attributes, and marks versus blocks.
