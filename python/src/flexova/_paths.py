"""Package-internal path handling. Entry names are restricted to [A-Za-z0-9._-/] (profile entryNamePattern),
so references never need percent-decoding or Unicode normalization."""

import re

from ._spec import PROFILE

ENTRY_NAME = re.compile(PROFILE["entryNamePattern"])
SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*:")
_BAD_CHARS = set("?#%\\ \t\r\n")


def parent_dir(path: str) -> str:
    return path.rpartition("/")[0]


def resolve(base_dir: str, ref: str):
    """Resolve a relative reference (no scheme, query or fragment) against a directory inside the package.
    Returns the package path, or None if the reference is malformed or escapes the package root."""
    if not ref or ref.startswith("/") or any(ch in _BAD_CHARS for ch in ref):
        return None
    parts = base_dir.split("/") if base_dir else []
    for seg in ref.split("/"):
        if seg == "" or seg == ".":
            if seg == "":
                return None
            continue
        if seg == "..":
            if not parts:
                return None
            parts.pop()
        else:
            parts.append(seg)
    path = "/".join(parts)
    return path if ENTRY_NAME.fullmatch(path) else None
