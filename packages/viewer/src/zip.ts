// Minimal ZIP reader for the viewer: central directory + native DecompressionStream, with the profile's
// limits enforced from declared sizes before anything is inflated (spec 3.2 and 9).
import { LIMITS } from "./render.js";

export class ViewerError extends Error {
  constructor(
    readonly code: "NOT_A_PACKAGE" | "TOO_LARGE" | "SEALED" | "UNSUPPORTED_VERSION" | "LOAD_FAILED",
    message: string,
  ) {
    super(message);
  }
}

interface Entry {
  method: number;
  csize: number;
  usize: number;
  offset: number;
}

export type ReadEntry = (name: string) => Promise<Uint8Array | null>;

export function unzip(data: Uint8Array): ReadEntry {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u32 = (at: number) => dv.getUint32(at, true);
  const u16 = (at: number) => dv.getUint16(at, true);
  const fail = () => {
    throw new ViewerError("NOT_A_PACKAGE", "This file is not a Flexova package.");
  };
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (u32(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0 || (eocd >= 20 && u32(eocd - 20) === 0x07064b50)) fail();
  const count = u16(eocd + 10);
  if (count > LIMITS.maxEntries)
    throw new ViewerError("TOO_LARGE", "The package has too many files.");
  const entries = new Map<string, Entry>();
  let p = u32(eocd + 16);
  let total = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > eocd || u32(p) !== 0x02014b50) fail();
    const [method, csize, usize, nlen] = [u16(p + 10), u32(p + 20), u32(p + 24), u16(p + 28)];
    const name = new TextDecoder().decode(data.subarray(p + 46, p + 46 + nlen));
    total += usize;
    if (
      usize > LIMITS.maxEntryBytes ||
      total > LIMITS.maxTotalBytes ||
      (usize >= LIMITS.compressionRatioMinBytes &&
        (csize === 0 || usize / csize > LIMITS.maxCompressionRatio))
    ) {
      throw new ViewerError("TOO_LARGE", "The package exceeds the size limits for safe viewing.");
    }
    // Encrypted entries are left out: they cannot be read without a key.
    if (!(u16(p + 8) & 0x41)) entries.set(name, { method, csize, usize, offset: u32(p + 42) });
    p += 46 + nlen + u16(p + 30) + u16(p + 32);
  }

  return async (name) => {
    const e = entries.get(name);
    if (!e || e.offset + 30 > data.length || u32(e.offset) !== 0x04034b50) return null;
    const start = e.offset + 30 + u16(e.offset + 26) + u16(e.offset + 28);
    const raw = data.subarray(start, start + e.csize);
    if (e.method === 0) return e.csize === e.usize ? raw : null;
    if (e.method !== 8) return null;
    const out = new Uint8Array(e.usize);
    let size = 0;
    // An in-memory stream: Blob.stream() goes through the network process in WebKit.
    const reader = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(c) {
        c.enqueue(raw as Uint8Array<ArrayBuffer>);
        c.close();
      },
    })
      .pipeThrough(new DecompressionStream("deflate-raw"))
      .getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.length > e.usize) {
          await reader.cancel();
          return null; // more output than declared: never allocate beyond the declared size
        }
        out.set(value, size);
        size += value.length;
      }
    } catch {
      // Some engines reject bytes after the end of the deflate stream; the output is still complete.
    }
    return size === e.usize ? out : null;
  };
}
