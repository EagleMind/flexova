"""Collision check for format names and file extensions.
Extension sources: GitHub Linguist, jshttp mime-db (IANA + Apache + nginx), freedesktop shared-mime-info (local), /etc/mime.types.
Name sources: npm, PyPI, crates.io, RubyGems, NuGet, github.com/<name>.
Usage: python3 name_check.py name[:ext[,ext2]] ...   (ext defaults to the name)"""
import json, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

UA = "flex-name-availability-check"
def curl(url, head_only=False):
    args = ["curl", "-s", "--max-time", "25", "-A", UA, "-L"] + (["-o", "/dev/null", "-w", "%{http_code}"] if head_only else [])
    return subprocess.run(args + [url], capture_output=True, text=True).stdout

# ---------- extension databases ----------
exts = {}
def add(ext, src): exts.setdefault(ext.lower(), set()).add(src)
for m in re.finditer(r'^\s*-\s*"\.([^"]+)"', curl("https://raw.githubusercontent.com/github-linguist/linguist/main/lib/linguist/languages.yml"), re.M):
    add(m.group(1), "linguist")
for mime, info in json.loads(curl("https://raw.githubusercontent.com/jshttp/mime-db/master/db.json")).items():
    for e in info.get("extensions", []): add(e, "mime-db:" + mime)
for line in open("/usr/share/mime/globs2"):
    m = re.match(r"\d+:([^:]+):\*\.([^:\s]+)", line)
    if m: add(m.group(2), "freedesktop:" + m.group(1))
for line in open("/etc/mime.types"):
    if line.strip() and not line.startswith("#"):
        mime, *es = line.split()
        for e in es: add(e, "mime.types:" + mime)

REG = {
    "npm": lambda n: f"https://registry.npmjs.org/{n.lower()}",
    "pypi": lambda n: f"https://pypi.org/pypi/{n}/json",
    "crates": lambda n: f"https://crates.io/api/v1/crates/{n}",
    "gems": lambda n: f"https://rubygems.org/api/v1/gems/{n}.json",
    "nuget": lambda n: f"https://api.nuget.org/v3-flatcontainer/{n.lower()}/index.json",
    "github": lambda n: f"https://github.com/{n}",
}
def check(spec):
    name, _, e = spec.partition(":")
    ext_list = (e or name).split(",")
    reg = {k: curl(f(name), head_only=True) for k, f in REG.items()}
    return name, {x: sorted(exts.get(x.lower(), [])) for x in ext_list}, reg

if __name__ == "__main__":
    print(f"extension DB: {len(exts)} known extensions\n")
    print(f"{'name':12} {'ext collisions':44} " + " ".join(f"{k:6}" for k in REG))
    with ThreadPoolExecutor(12) as pool:
        for name, ext_hits, reg in pool.map(check, sys.argv[1:]):
            ec = "; ".join(f".{x}: {'FREE' if not h else ','.join(h)[:30]}" for x, h in ext_hits.items())
            regs = " ".join(f"{('free' if reg[k] == '404' else 'TAKEN' if reg[k] == '200' else reg[k]):6}" for k in REG)
            print(f"{name:12} {ec:44} {regs}")
