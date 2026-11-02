"""Validation issues and reports (codes and severities come from spec/errors.json)."""

from dataclasses import dataclass, field

from ._spec import ERRORS, PHASES


@dataclass(frozen=True)
class Issue:
    code: str
    severity: str
    path: str
    message: str


@dataclass
class Report:
    valid: bool
    issues: list = field(default_factory=list)

    @property
    def codes(self) -> list:
        """Sorted, de-duplicated codes: the unit compared by the conformance suite."""
        return sorted({i.code for i in self.issues})


class FlexovaError(Exception):
    """Raised by write() when the package it built does not validate."""

    def __init__(self, report: Report):
        self.report = report
        details = "; ".join(f"{i.code} {i.path}: {i.message}" for i in report.issues if i.severity == "error")
        super().__init__(f"Flexova package is invalid: {details}")


class Collector:
    def __init__(self):
        self._items: list = []

    def add(self, code: str, path: str = "", detail: str = "") -> None:
        spec = ERRORS["codes"][code]  # KeyError here means an undefined code: a bug
        message = spec["message"] + (f" ({detail})" if detail else "")
        self._items.append((PHASES.index(spec["phase"]), path, code, Issue(code, spec["severity"], path, message)))

    def fatal(self) -> bool:
        return any(ERRORS["codes"][code]["fatal"] for _, _, code, _ in self._items)

    def report(self) -> Report:
        issues = [item[3] for item in sorted(self._items, key=lambda t: (t[0], t[1], t[2], t[3].message))]
        return Report(valid=not any(i.severity == "error" for i in issues), issues=issues)
