// React 18 and 19: <flexova-viewer> is a standard custom element, so React renders it directly.
// npm install @flexova/viewer
import { useEffect, useRef, useState } from "react";
import "@flexova/viewer"; // registers <flexova-viewer> (safe to import during SSR)

/**
 * Displays a Flexova document. `source` can be a URL, an ArrayBuffer, a Uint8Array or a Blob/File
 * (for example from <input type="file">). Fetching is up to you, so authenticated requests just work.
 */
export function FlexovaDocument({ source, theme, onLoad, onError }) {
  const ref = useRef(null);
  const [toc, setToc] = useState([]);

  useEffect(() => {
    const viewer = ref.current;
    const handleLoad = (e) => {
      setToc(e.detail.toc);
      onLoad?.(e.detail);
    };
    const handleError = (e) => onError?.(e.detail);
    viewer.addEventListener("flexova-load", handleLoad);
    viewer.addEventListener("flexova-error", handleError);
    return () => {
      viewer.removeEventListener("flexova-load", handleLoad);
      viewer.removeEventListener("flexova-error", handleError);
    };
  }, [onLoad, onError]);

  useEffect(() => {
    if (!source) return;
    const viewer = ref.current;
    if (typeof source === "string") {
      fetch(source, { credentials: "include" })
        .then((r) => r.arrayBuffer())
        .then((bytes) => viewer.load(bytes));
    } else {
      viewer.load(source);
    }
  }, [source]);

  return (
    <div>
      {toc.length > 0 && (
        <nav aria-label="Contents">
          <ol>
            {toc.map((entry) => (
              <li key={entry.href}>
                <a
                  href={entry.href}
                  onClick={(e) => {
                    e.preventDefault();
                    ref.current.goTo(entry.href);
                  }}
                >
                  {entry.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {/* theme: "light" | "dark" | undefined (follow the system) */}
      <flexova-viewer ref={ref} theme={theme} />
    </div>
  );
}
