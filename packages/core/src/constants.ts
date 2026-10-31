/**
 * Flexova naming constants (ADR-0001). These must match `spec/constants.json`,
 * which `constants.test.ts` enforces. Change them only through an ADR.
 */

export const FORMAT_NAME = "Flexova";

/** File extension of a Flexova package. */
export const FILE_EXTENSION = ".flexova";

/** Extension of the self-contained single-file HTML rendition (ADR-0006). */
export const HTML_EXTENSION = ".flexova.html";

/** Media type served over HTTP and used for OS registration; to be registered in IANA's vendor tree. */
export const MEDIA_TYPE = "application/vnd.flexova+zip";

/** Content of the `mimetype` entry, stored first and uncompressed: the container is EPUB 3.3 OCF (ADR-0003). */
export const CONTAINER_MIMETYPE = "application/epub+zip";

/** Version of the content profile this package implements. */
export const PROFILE_VERSION = "1.0";

/**
 * Namespace URI for the OPF `flexova:` prefix and spec identifiers.
 * PLACEHOLDER: replaced once the project domain is registered (see docs/STATUS.md).
 */
export const NAMESPACE_URI = "https://flexova.example/ns/1.0#";

/** Location of the Flexova manifest (profile version, level, tokens, entry hashes) inside the package. */
export const MANIFEST_PATH = "META-INF/flexova.json";

/** Custom element name of the embeddable viewer (ADR-0007). */
export const VIEWER_ELEMENT = "flexova-viewer";
