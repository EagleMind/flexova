import { FlexovaViewer } from "./element.js";

export { FlexovaViewer, type LoadDetail, type TocEntry } from "./element.js";
export { ViewerError } from "./zip.js";

/** Custom element name (must match spec/constants.json viewerElement). */
export const VIEWER_ELEMENT = "flexova-viewer";

// Register automatically in browsers; importing in Node (SSR) is harmless.
if (globalThis.customElements && !customElements.get(VIEWER_ELEMENT)) {
  customElements.define(VIEWER_ELEMENT, FlexovaViewer);
}

declare global {
  interface HTMLElementTagNameMap {
    "flexova-viewer": FlexovaViewer;
  }
}
