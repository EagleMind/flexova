#!/usr/bin/env node
// Tiny static server for the end-to-end tests (no dependencies). Serves only the folders tests need.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]+$/, "");
const allowed = ["e2e/www/", "conformance/", "packages/viewer/dist/", "build/e2e/"];
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".flexova": "application/vnd.flexova+zip",
  ".css": "text/css",
};
const port = Number(process.env.PORT ?? 4173);

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).slice(1);
  if (path === "healthz") return res.end("ok");
  const file = normalize(join(root, path));
  if (!file.startsWith(root + sep) || !allowed.some((a) => path.startsWith(a))) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => console.log(`e2e server on http://127.0.0.1:${port}`));
