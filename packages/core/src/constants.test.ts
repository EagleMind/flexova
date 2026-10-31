import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as C from "./index.js";

const spec = JSON.parse(
  readFileSync(new URL("../../../spec/constants.json", import.meta.url), "utf8"),
) as Record<string, string>;

describe("naming constants", () => {
  it("match spec/constants.json, the single source of truth", () => {
    expect({
      formatName: C.FORMAT_NAME,
      fileExtension: C.FILE_EXTENSION,
      htmlExtension: C.HTML_EXTENSION,
      mediaType: C.MEDIA_TYPE,
      containerMimetype: C.CONTAINER_MIMETYPE,
      profileVersion: C.PROFILE_VERSION,
      namespaceUri: C.NAMESPACE_URI,
      manifestPath: C.MANIFEST_PATH,
      viewerElement: C.VIEWER_ELEMENT,
    }).toEqual(Object.fromEntries(Object.entries(spec).filter(([k]) => !k.startsWith("$"))));
  });

  it("are internally consistent", () => {
    expect(C.HTML_EXTENSION).toBe(`${C.FILE_EXTENSION}.html`);
    expect(C.MEDIA_TYPE).toMatch(/^application\/vnd\.[a-z0-9.-]+\+zip$/);
    // Custom element names must be lowercase and contain a hyphen.
    expect(C.VIEWER_ELEMENT).toMatch(/^[a-z][a-z0-9]*-[a-z0-9-]+$/);
  });
});
