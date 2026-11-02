import { CODES, PHASES, type Severity } from "./spec.js";

export interface Issue {
  code: string;
  severity: Severity;
  path: string;
  message: string;
}

export interface Report {
  valid: boolean;
  issues: Issue[];
  /** Sorted, de-duplicated codes: the unit compared by the conformance suite. */
  codes: string[];
}

/** Thrown by write() when the package it built does not validate. */
export class FlexovaError extends Error {
  readonly report: Report;
  constructor(report: Report) {
    const details = report.issues
      .filter((i) => i.severity === "error")
      .map((i) => `${i.code} ${i.path}: ${i.message}`)
      .join("; ");
    super(`Flexova package is invalid: ${details}`);
    this.name = "FlexovaError";
    this.report = report;
  }
}

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export class Collector {
  private items: { phase: number; path: string; code: string; issue: Issue }[] = [];

  add(code: string, path = "", detail = ""): void {
    const spec = CODES[code];
    if (!spec) throw new Error(`undefined validation code ${code}`);
    const message = spec.message + (detail ? ` (${detail})` : "");
    this.items.push({
      phase: PHASES.indexOf(spec.phase),
      path,
      code,
      issue: { code, severity: spec.severity, path, message },
    });
  }

  fatal(): boolean {
    return this.items.some((i) => CODES[i.code]?.fatal === true);
  }

  report(): Report {
    const sorted = [...this.items].sort(
      (a, b) =>
        a.phase - b.phase ||
        byCodePoint(a.path, b.path) ||
        byCodePoint(a.code, b.code) ||
        byCodePoint(a.issue.message, b.issue.message),
    );
    const issues = sorted.map((i) => i.issue);
    return {
      valid: !issues.some((i) => i.severity === "error"),
      issues,
      codes: [...new Set(issues.map((i) => i.code))].sort(byCodePoint),
    };
  }
}
