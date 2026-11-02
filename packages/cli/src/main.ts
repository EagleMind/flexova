// The flexova command. main() is the whole CLI; it returns the exit code and writes through `io`, so tests
// can run it in-process.
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import {
  FlexovaError,
  generateSigningKey,
  pack,
  read,
  sign,
  unpack,
  validate,
  verify,
  write,
  type Ed25519Jwk,
  type Report,
  type TrustedKeys,
} from "@flexova/core";
import { fromHtml, toHtml } from "@flexova/html";
import type { Variant } from "@flexova/import";
import { CONFIG_FILE, load, ToolError, UsageError } from "./sources.js";

export const VERSION = "0.1.0";

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

const consoleIo: Io = {
  out: (t) => process.stdout.write(t + "\n"),
  err: (t) => process.stderr.write(t + "\n"),
};

/** Exit codes. */
export const EXIT = { ok: 0, failed: 1, usage: 2, tool: 3 } as const;

const HELP = `flexova ${VERSION}: build, check and sign Flexova (.flexova) documents

Usage: flexova <command> [options]

Commands:
  new <folder>                 Start a Markdown project
  build <input>                Build a .flexova from a project folder, a Markdown file, or a
                               document Pandoc reads (.docx, .odt, .html, .tex, .rst, ...)
  check <file>...              Validate packages
  inspect <file>               Show a package's metadata, chapters, assets and signature
  pack --html <file>           Write a static, script-free .flexova.html
  pack <folder>                Zip an unpacked package folder into a .flexova
  unpack <file>                Extract a .flexova or .flexova.html into a folder
  export --epub <file>         Write an .epub copy for EPUB readers
  keygen [name]                Create an Ed25519 signing key pair
  sign <file> --key <jwk>      Sign a package
  verify <file> --keys <jwks>  Verify a package's signature against trusted keys

Run "flexova <command> --help" for a command's options.`;

const COMMON = {
  help: { type: "boolean", short: "h" },
  output: { type: "string", short: "o" },
  json: { type: "boolean" },
} as const satisfies ParseArgsConfig["options"];

interface Command {
  usage: string;
  options: ParseArgsConfig["options"];
  run(args: string[], values: Record<string, unknown>, io: Io): Promise<number>;
}

const fail = (message: string) => {
  throw new UsageError(message);
};
const one = (args: string[], what: string): string =>
  args.length === 1 ? (args[0] as string) : fail(`expected one ${what}`);
const outPath = (values: Record<string, unknown>, fallback: string) =>
  (values.output as string | undefined) ?? fallback;
const stem = (path: string) => basename(path).replace(/(\.flexova)?(\.[^.]*)?$/, "") || "document";
const readBytes = (path: string): Uint8Array => {
  try {
    return readFileSync(path);
  } catch (e) {
    throw new UsageError(
      `cannot read ${path}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`,
    );
  }
};

function save(path: string, data: Uint8Array | string, io: Io, mode?: number): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, data, mode === undefined ? undefined : { mode });
  if (mode !== undefined) chmodSync(path, mode);
  io.err(`wrote ${path}`);
}

function printIssues(report: Report, io: Io): void {
  for (const i of report.issues)
    io.out(`  ${i.severity.padEnd(7)} ${i.code}${i.path ? `  ${i.path}` : ""}: ${i.message}`);
}

/** A stable urn:uuid (version 8, from SHA-256) for inputs without an identifier. */
function stableId(fingerprint: Uint8Array): string {
  const h = createHash("sha256").update(fingerprint).digest();
  h[6] = ((h[6] as number) & 0x0f) | 0x80;
  h[8] = ((h[8] as number) & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** dcterms:modified: --modified, then the project's value, then SOURCE_DATE_EPOCH, then now. */
function modifiedTime(given: string | undefined): string {
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  if (given) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(given))
      fail("--modified must look like 2026-11-02T09:30:00Z");
    return given;
  }
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) return iso(new Date(Number(epoch) * 1000));
  return iso(new Date());
}

function readKeyFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new UsageError(`${path}: ${(e as Error).message}`);
  }
}

const COMMANDS: Record<string, Command> = {
  new: {
    usage: "flexova new <folder> [--title <title>] [--lang <tag>]",
    options: { title: { type: "string" }, lang: { type: "string" } },
    async run(args, values, io) {
      const dir = one(args, "folder");
      if (existsSync(dir) && readdirSync(dir).length)
        fail(`${dir} already exists and is not empty`);
      const title = (values.title as string | undefined) ?? "My document";
      const config = {
        title,
        language: (values.lang as string | undefined) ?? "en",
        authors: [],
        chapters: ["01-introduction.md", "02-details.md"],
        tokens: { color: { accent: { light: "#0b5fff", dark: "#7aa7ff" } } },
      };
      mkdirSync(join(dir, "images"), { recursive: true });
      save(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2) + "\n", io);
      save(
        join(dir, "01-introduction.md"),
        `# Introduction\n\nWrite in Markdown. Each level-1 heading starts a chapter.\n\n> [!TIP]\n> Callouts use GitHub's alert syntax: NOTE, TIP, IMPORTANT, WARNING and CAUTION.\n\nSee [the details](02-details.md) for tables, images and footnotes.\n`,
        io,
      );
      save(
        join(dir, "02-details.md"),
        `# Details\n\n| Feature | Syntax |\n| ------- | ------ |\n| Table   | Pipes  |\n| Image   | \`![Describe the image](images/photo.png)\` |\n\nFootnotes work too.[^1]\n\n[^1]: They become endnotes, linked both ways.\n`,
        io,
      );
      io.out(`Created ${dir}. Build it with: flexova build ${dir}`);
      return EXIT.ok;
    },
  },

  build: {
    usage:
      "flexova build <folder | file.md | file.docx …> [-o out.flexova] [--html] [--title …] [--lang …] [--author …]… [--id urn:…] [--modified …] [--style Name=variant]… [--sign key.jwk] [--strict]",
    options: {
      title: { type: "string" },
      lang: { type: "string" },
      author: { type: "string", multiple: true },
      id: { type: "string" },
      modified: { type: "string" },
      html: { type: "boolean" },
      sign: { type: "string" },
      style: { type: "string", multiple: true },
      strict: { type: "boolean" },
    },
    async run(args, values, io) {
      const input = one(args, "input");
      const styleMap: Record<string, Variant> = {};
      for (const pair of (values.style as string[] | undefined) ?? []) {
        const [name, variant] = pair.split("=", 2);
        if (
          !name ||
          !variant ||
          !["note", "tip", "important", "warning", "caution"].includes(variant)
        ) {
          fail(
            `--style expects Name=variant with a variant of note, tip, important, warning or caution: ${pair}`,
          );
        }
        styleMap[name as string] = variant as Variant;
      }
      const { result, config, fingerprint } = load(input, {
        title: values.title as string | undefined,
        language: values.lang as string | undefined,
        authors: values.author as string[] | undefined,
        styleMap,
      });
      for (const w of result.warnings) io.err(`warning: ${w}`);
      if (values.strict && result.warnings.length) {
        io.err(`build stopped: ${result.warnings.length} warning(s) with --strict`);
        return EXIT.failed;
      }
      let bytes: Uint8Array;
      try {
        bytes = await write({
          ...result,
          identifier:
            (values.id as string | undefined) ?? config.identifier ?? stableId(fingerprint),
          modified: modifiedTime((values.modified as string | undefined) ?? config.modified),
          ...(config.tokens ? { tokens: config.tokens } : {}),
          ...(config.accessibility ? { accessibility: config.accessibility } : {}),
        });
      } catch (e) {
        if (!(e instanceof FlexovaError)) throw e;
        io.err(
          "The converted document is not valid Flexova. Please report this as a bug, with the input:",
        );
        printIssues(e.report, { out: io.err, err: io.err });
        return EXIT.failed;
      }
      if (values.sign) bytes = await sign(bytes, readKeyFile(values.sign as string) as Ed25519Jwk);
      const out = outPath(values, `${stem(input.replace(/[/\\]+$/, ""))}.flexova`);
      save(out, bytes, io);
      if (values.html) {
        const { html, warnings } = await toHtml(bytes);
        for (const w of warnings) io.err(`warning: ${w}`);
        save(out.replace(/\.flexova$/, "") + ".flexova.html", html, io);
      }
      return EXIT.ok;
    },
  },

  check: {
    usage: "flexova check <file>... [--json]",
    options: {},
    async run(args, values, io) {
      if (!args.length) fail("expected at least one file");
      const results = [];
      for (const file of args) {
        const report = await validate(readBytes(file));
        results.push({ file, ...report });
        if (!values.json) {
          io.out(`${report.valid ? "valid  " : "INVALID"}  ${file}`);
          printIssues(report, io);
        }
      }
      if (values.json) io.out(JSON.stringify(results, null, 2));
      return results.every((r) => r.valid) ? EXIT.ok : EXIT.failed;
    },
  },

  inspect: {
    usage: "flexova inspect <file> [--json]",
    options: {},
    async run(args, values, io) {
      const file = one(args, "file");
      const bytes = readBytes(file);
      let pkg;
      try {
        pkg = await read(bytes);
      } catch (e) {
        if (!(e instanceof FlexovaError)) throw e;
        io.out(`INVALID  ${file} (run flexova check for details)`);
        return EXIT.failed;
      }
      const assets = pkg.items
        .filter((i) => !i.mediaType.includes("xhtml") && i.mediaType !== "text/css")
        .map((i) => ({
          path: i.path,
          mediaType: i.mediaType,
          size: pkg.entries.get(i.path)?.length ?? 0,
        }));
      const sig = pkg.entries.get("META-INF/flexova.sig.jws");
      let signature: { kid: string | null; alg: string | null } | null = null;
      if (sig) {
        try {
          const header = JSON.parse(
            Buffer.from(new TextDecoder().decode(sig).split(".")[0] ?? "", "base64url").toString(
              "utf8",
            ),
          );
          signature = {
            kid: typeof header.kid === "string" ? header.kid : null,
            alg: typeof header.alg === "string" ? header.alg : null,
          };
        } catch {
          signature = { kid: null, alg: null };
        }
      }
      const info = {
        file,
        size: bytes.length,
        title: pkg.title,
        language: pkg.language,
        chapters: pkg.spine,
        assets,
        tokens: pkg.tokens ?? null,
        warnings: pkg.report.issues
          .filter((i) => i.severity === "warning")
          .map((i) => `${i.code} ${i.path}`),
        signature,
      };
      if (values.json) {
        io.out(JSON.stringify(info, null, 2));
        return EXIT.ok;
      }
      io.out(`${info.title}  (${info.language}, ${(info.size / 1024).toFixed(1)} KB)`);
      io.out(`Chapters (${info.chapters.length}):`);
      for (const c of info.chapters) io.out(`  ${c}`);
      io.out(`Assets (${assets.length}):`);
      for (const a of assets) io.out(`  ${a.path}  ${a.mediaType}  ${a.size} B`);
      if (info.warnings.length) io.out(`Warnings: ${info.warnings.join(", ")}`);
      io.out(
        signature
          ? `Signature: present (kid ${signature.kid ?? "?"}, alg ${signature.alg ?? "?"}); check it with flexova verify`
          : "Signature: none",
      );
      return EXIT.ok;
    },
  },

  pack: {
    usage:
      "flexova pack --html <file.flexova> [-o out.flexova.html]  |  flexova pack <folder> [-o out.flexova]",
    options: { html: { type: "boolean" } },
    async run(args, values, io) {
      const input = one(args, values.html ? "file" : "folder");
      if (values.html) {
        const { html, warnings } = await toHtml(readBytes(input));
        for (const w of warnings) io.err(`warning: ${w}`);
        save(outPath(values, `${stem(input)}.flexova.html`), html, io);
        return EXIT.ok;
      }
      if (!statSync(input).isDirectory())
        fail(`${input} is not a folder (did you mean pack --html?)`);
      const entries = new Map<string, Uint8Array>();
      const walk = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const full = join(d, e.name);
          if (e.isDirectory()) walk(full);
          else entries.set(relative(input, full).split(sep).join("/"), readFileSync(full));
        }
      };
      walk(input);
      const bytes = pack(entries);
      const report = await validate(bytes);
      if (!report.valid) {
        io.out(`INVALID  ${input}`);
        printIssues(report, io);
        return EXIT.failed;
      }
      save(outPath(values, `${stem(input.replace(/[/\\]+$/, ""))}.flexova`), bytes, io);
      return EXIT.ok;
    },
  },

  unpack: {
    usage: "flexova unpack <file.flexova | file.flexova.html> [-o folder]",
    options: {},
    async run(args, values, io) {
      const input = one(args, "file");
      const raw = readBytes(input);
      const bytes = /\.html?$/i.test(input) ? fromHtml(new TextDecoder().decode(raw)) : raw;
      const entries = unpack(bytes);
      const dir = resolve(outPath(values, stem(input)));
      if (existsSync(dir) && readdirSync(dir).length)
        fail(`${dir} already exists and is not empty`);
      for (const [name, data] of entries) {
        const target = resolve(dir, name);
        if (!target.startsWith(dir + sep)) fail(`unsafe entry name ${name}`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
      }
      io.err(`wrote ${entries.size} files to ${dir}`);
      return EXIT.ok;
    },
  },

  export: {
    usage: "flexova export --epub <file.flexova> [-o out.epub]",
    options: { epub: { type: "boolean" } },
    async run(args, values, io) {
      if (!values.epub) fail("choose a format: --epub");
      const input = one(args, "file");
      const bytes = readBytes(input);
      const report = await validate(bytes);
      if (!report.valid) {
        io.out(`INVALID  ${input}`);
        printIssues(report, io);
        return EXIT.failed;
      }
      // An unsealed Flexova package is already a valid EPUB 3.3 publication.
      save(outPath(values, `${stem(input)}.epub`), bytes, io);
      return EXIT.ok;
    },
  },

  keygen: {
    usage:
      "flexova keygen [name] [--kid <id>]   (writes <name>.private.jwk.json and <name>.jwks.json)",
    options: { kid: { type: "string" } },
    async run(args, values, io) {
      const name = args[0] ?? "flexova-signing";
      if (args.length > 1) fail("expected at most one name");
      const privatePath = `${name}.private.jwk.json`;
      const publicPath = `${name}.jwks.json`;
      for (const p of [privatePath, publicPath]) if (existsSync(p)) fail(`${p} already exists`);
      const { privateJwk, publicJwk } = await generateSigningKey(values.kid as string | undefined);
      save(privatePath, JSON.stringify(privateJwk, null, 2) + "\n", io, 0o600);
      save(publicPath, JSON.stringify({ keys: [publicJwk] }, null, 2) + "\n", io);
      io.out(`Key ID: ${publicJwk.kid}`);
      io.out(
        `Keep ${privatePath} secret. Publish ${publicPath} at https://<your-domain>/.well-known/flexova/jwks.json`,
      );
      return EXIT.ok;
    },
  },

  sign: {
    usage:
      "flexova sign <file.flexova> --key <private.jwk.json> [-o out.flexova] [--kid <id>] [--iat <seconds>]",
    options: { key: { type: "string" }, kid: { type: "string" }, iat: { type: "string" } },
    async run(args, values, io) {
      const input = one(args, "file");
      if (!values.key) fail("--key is required");
      const iat = values.iat === undefined ? undefined : Number(values.iat);
      if (iat !== undefined && !(Number.isInteger(iat) && iat >= 0))
        fail("--iat must be whole seconds since 1970");
      const key = readKeyFile(values.key as string) as Ed25519Jwk;
      try {
        const signed = await sign(readBytes(input), key, {
          ...(values.kid ? { kid: values.kid as string } : {}),
          ...(iat === undefined ? {} : { iat }),
        });
        save(outPath(values, input), signed, io);
      } catch (e) {
        if (e instanceof FlexovaError) {
          io.out(`INVALID  ${input} (only valid packages can be signed)`);
          printIssues(e.report, io);
          return EXIT.failed;
        }
        if (e instanceof TypeError) fail(e.message);
        throw e;
      }
      return EXIT.ok;
    },
  },

  verify: {
    usage: "flexova verify <file.flexova> --keys <jwks.json> [--json]",
    options: { keys: { type: "string" } },
    async run(args, values, io) {
      const input = one(args, "file");
      if (!values.keys) fail("--keys is required (a JWKS, a JWK, or a list of JWKs)");
      const keys = readKeyFile(values.keys as string);
      const trusted = (
        Array.isArray(keys) || (keys && typeof keys === "object" && "keys" in keys) ? keys : [keys]
      ) as TrustedKeys;
      const result = await verify(readBytes(input), trusted);
      if (values.json)
        io.out(
          JSON.stringify(
            {
              file: input,
              ok: result.ok,
              code: result.code,
              kid: result.kid,
              message: result.message,
            },
            null,
            2,
          ),
        );
      else
        io.out(
          result.ok
            ? `verified  ${input}  (key ${result.kid})`
            : `FAILED  ${input}  ${result.code}: ${result.message}`,
        );
      return result.ok ? EXIT.ok : EXIT.failed;
    },
  },
};

/** Run the CLI with `argv` (without the node and script paths). Returns the exit code. */
export async function main(argv: string[], io: Io = consoleIo): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === "--help" || name === "-h" || name === "help") {
    io.out(HELP);
    return name ? EXIT.ok : EXIT.usage;
  }
  if (name === "--version" || name === "-v") {
    io.out(VERSION);
    return EXIT.ok;
  }
  const command = COMMANDS[name];
  if (!command) {
    io.err(`flexova: unknown command "${name}"\n\n${HELP}`);
    return EXIT.usage;
  }
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { ...COMMON, ...command.options },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) {
      io.out(`Usage: ${command.usage}`);
      return EXIT.ok;
    }
    return await command.run(positionals, values as Record<string, unknown>, io);
  } catch (e) {
    if (
      e instanceof UsageError ||
      (e as NodeJS.ErrnoException).code?.startsWith?.("ERR_PARSE_ARGS")
    ) {
      io.err(`flexova ${name}: ${(e as Error).message}\nUsage: ${command.usage}`);
      return EXIT.usage;
    }
    if (e instanceof FlexovaError) {
      io.err(`flexova ${name}: ${e.message}`);
      return EXIT.failed;
    }
    if (e instanceof ToolError) {
      io.err(`flexova ${name}: ${e.message}`);
      return EXIT.tool;
    }
    io.err(`flexova ${name}: ${(e as Error).message}`);
    return EXIT.failed;
  }
}
