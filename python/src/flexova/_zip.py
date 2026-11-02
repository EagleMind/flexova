"""ZIP phase: a minimal, bounded ZIP reader (no zipfile, so behavior matches @flexova/core exactly) and a
deterministic writer."""

import struct
import zlib

from ._paths import ENTRY_NAME
from ._spec import CONSTANTS, LIMITS

_EOCD = b"PK\x05\x06"
_CDH = b"PK\x01\x02"
_LFH = b"PK\x03\x04"
_ZIP64_LOCATOR = b"PK\x06\x07"
_MAX32 = 0xFFFFFFFF
_DOS_DATE = (0 << 9) | (1 << 5) | 1  # 1980-01-01, the fixed timestamp of every entry we write


def _inflate(comp: bytes, usize: int):
    """Raw-deflate decode that never produces more than usize + 1 bytes. Bytes after the end of the
    deflate stream are ignored (as every browser and fflate do); a truncated stream is an error."""
    d = zlib.decompressobj(-15)
    try:
        out = d.decompress(comp, usize + 1)
    except zlib.error:
        return None
    if len(out) != usize or not d.eof:
        return None
    return out


def read_zip(data: bytes, c):
    """Run every ZIP-phase check. Returns {name: bytes} for file entries, or None if any error was found."""
    n = len(data)
    if n < 22:
        c.add("ZIP_NOT_ZIP")
        return None
    eocd = -1
    for i in range(n - 22, max(0, n - 22 - 0xFFFF) - 1, -1):
        if data[i : i + 4] == _EOCD:
            eocd = i
            break
    if eocd < 0:
        c.add("ZIP_NOT_ZIP")
        return None
    _, disk, cd_disk, disk_entries, total, cd_size, cd_off, _ = struct.unpack_from("<IHHHHIIH", data, eocd)
    if (
        (eocd >= 20 and data[eocd - 20 : eocd - 16] == _ZIP64_LOCATOR)
        or disk != 0
        or cd_disk != 0
        or disk_entries != total
        or total == 0xFFFF
        or cd_size == _MAX32
        or cd_off == _MAX32
    ):
        c.add("ZIP_UNSUPPORTED_FEATURE")
        return None
    if total > LIMITS["maxEntries"]:
        c.add("ZIP_TOO_MANY_ENTRIES")
        return None
    if cd_off + cd_size > eocd:
        c.add("ZIP_NOT_ZIP")
        return None

    infos = []
    p = cd_off
    for _ in range(total):
        if p + 46 > eocd or data[p : p + 4] != _CDH:
            c.add("ZIP_NOT_ZIP")
            return None
        flags, method = struct.unpack_from("<HH", data, p + 8)
        crc, csize, usize = struct.unpack_from("<III", data, p + 16)
        nlen, xlen, clen = struct.unpack_from("<HHH", data, p + 28)
        (offset,) = struct.unpack_from("<I", data, p + 42)
        if p + 46 + nlen + xlen + clen > eocd:
            c.add("ZIP_NOT_ZIP")
            return None
        raw = data[p + 46 : p + 46 + nlen]
        infos.append((raw, flags, method, crc, csize, usize, offset))
        p += 46 + nlen + xlen + clen

    files = []  # (name, method, crc, csize, usize, offset)
    seen = set()
    total_bytes = 0
    for raw, flags, method, crc, csize, usize, offset in infos:
        name = raw.decode("latin-1")
        if any(b >= 0x80 for b in raw):
            c.add("ZIP_INVALID_NAME", name)
        else:
            is_dir = name.endswith("/")
            core = name[:-1] if is_dir else name
            if core.startswith("/") or "\\" in core or any(s in ("", ".", "..") for s in core.split("/")):
                c.add("ZIP_UNSAFE_PATH", name)
            elif not ENTRY_NAME.fullmatch(core):
                c.add("ZIP_INVALID_NAME", name)
        if flags & 0x41:
            c.add("ZIP_ENCRYPTED_ENTRY", name)
        if method not in (0, 8) or _MAX32 in (csize, usize, offset):
            c.add("ZIP_UNSUPPORTED_FEATURE", name)
        if name.lower() in seen:
            c.add("ZIP_DUPLICATE_ENTRY", name)
        seen.add(name.lower())
        if usize > LIMITS["maxEntryBytes"]:
            c.add("ZIP_SIZE_LIMIT", name)
        total_bytes += usize
        if usize >= LIMITS["compressionRatioMinBytes"] and (csize == 0 or usize / csize > LIMITS["maxCompressionRatio"]):
            c.add("ZIP_RATIO_LIMIT", name)
        if not name.endswith("/"):
            files.append((name, method, crc, csize, usize, offset))
    if total_bytes > LIMITS["maxTotalBytes"]:
        c.add("ZIP_SIZE_LIMIT")
    if c.fatal():
        return None

    entries = {}
    for name, method, crc, csize, usize, offset in files:
        content = None
        if offset + 30 <= n and data[offset : offset + 4] == _LFH:
            lnlen, lxlen = struct.unpack_from("<HH", data, offset + 26)
            start = offset + 30 + lnlen + lxlen
            if start + csize <= cd_off:
                comp = data[start : start + csize]
                if method == 0:
                    content = comp if csize == usize else None
                else:
                    content = _inflate(comp, usize)
        if content is None or (zlib.crc32(content) & _MAX32) != crc:
            c.add("ZIP_CORRUPT", name)
        else:
            entries[name] = content

    first = min(infos, key=lambda info: info[6]) if infos else None
    if first is None or first[0] != b"mimetype":
        c.add("ZIP_MIMETYPE_NOT_FIRST")
    else:
        _, _, method, _, _, _, offset = first
        if method != 0:
            c.add("ZIP_MIMETYPE_COMPRESSED", "mimetype")
        if offset + 30 <= n and struct.unpack_from("<H", data, offset + 28)[0] != 0:
            c.add("ZIP_MIMETYPE_EXTRA_FIELD", "mimetype")
        if "mimetype" in entries and entries["mimetype"] != CONSTANTS["containerMimetype"].encode("ascii"):
            c.add("ZIP_MIMETYPE_INVALID", "mimetype")
    return None if c.fatal() else entries


def write_zip(entries: list) -> bytes:
    """Deterministic ZIP: entries in the given order, fixed 1980-01-01 timestamps, no extra fields.
    entries: list of (name, bytes, compress: bool)."""
    local = bytearray()
    central = bytearray()
    for name, content, compress in entries:
        raw_name = name.encode("ascii")
        if compress:
            co = zlib.compressobj(9, zlib.DEFLATED, -15)
            comp = co.compress(content) + co.flush()
            method = 8
        else:
            comp, method = content, 0
        crc = zlib.crc32(content) & _MAX32
        offset = len(local)
        local += struct.pack(
            "<IHHHHHIIIHH", 0x04034B50, 20, 0, method, 0, _DOS_DATE, crc, len(comp), len(content), len(raw_name), 0
        )
        local += raw_name + comp
        central += struct.pack(
            "<IHHHHHHIIIHHHHHII",
            0x02014B50, 20, 20, 0, method, 0, _DOS_DATE, crc, len(comp), len(content),
            len(raw_name), 0, 0, 0, 0, 0, offset,
        )
        central += raw_name
    eocd = struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, len(entries), len(entries), len(central), len(local), 0)
    return bytes(local + central + eocd)
