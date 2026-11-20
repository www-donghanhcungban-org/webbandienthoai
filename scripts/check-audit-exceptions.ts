// Kiểm ngoại lệ quét phụ thuộc (BASE-DEP-004): mỗi GHSA/CVE bị `pnpm audit` bỏ qua (`auditConfig.ignoreGhsas`/
// `ignoreCves` của pnpm-workspace.yaml) phải có dòng trong audit-exceptions.json còn hạn, đủ khoá; mỗi dòng ngoại lệ
// phải đang được bỏ qua. Dạng danh sách không đọc chắc được → đỏ. Chạy: `pnpm audit:exceptions` (exit 1 khi sai).
import { readFileSync } from "node:fs";

const KEYS = ["ghsa", "cve", "package", "reason", "owner", "approved_by", "expires"];

type Exception = Record<string, string | null>;

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "");
}

// Phần mã của dòng (bỏ chú thích ` # …` cuối dòng và dòng chỉ có chú thích).
function code(line: string): string {
  return line.trimStart().startsWith("#") ? "" : line.replace(/\s#.*$/, "").trimEnd();
}

function flowIds(key: string, rest: string): string[] {
  const flow = rest.match(/^\[([^\]]*)\]$/);
  if (!flow) {
    throw new Error(`không đọc được ${key}: ${rest}`);
  }
  return (flow[1] ?? "")
    .split(",")
    .map(unquote)
    .filter((s) => s !== "");
}

// Fail-closed: dòng nào nhắc `key` mà không đúng dạng `  key:` (khoá có nháy, `key :`, khoá tường minh `? key`…)
// hay mục danh sách không đọc được → ném lỗi, không bỏ qua im lặng.
export function ignoredIds(text: string, key: string): string[] {
  const out: string[] = [];
  let inList = false;
  for (const line of text.split("\n").map(code)) {
    if (line === "") {
      continue;
    }
    const head = line.match(new RegExp(`^\\s+${key}:(?:\\s+(.*))?$`));
    if (head) {
      const rest = (head[1] ?? "").trim();
      inList = rest === "";
      out.push(...(inList ? [] : flowIds(key, rest)));
      continue;
    }
    if (line.includes(key)) {
      throw new Error(`không đọc chắc dòng nhắc ${key}: ${line.trim()}`);
    }
    const item = line.match(/^\s+-\s+(\S+)$/);
    if (inList && !item && line.trimStart().startsWith("-")) {
      throw new Error(`không đọc được mục ${key}: ${line.trim()}`);
    }
    inList = inList && item !== null;
    out.push(...(inList && item ? [unquote(item[1] ?? "")] : []));
  }
  return out;
}

// `auditConfig` chỉ đọc chắc ở dạng khối: dòng đúng `auditConfig:` và dòng mã kế không mở flow `{`/`[`.
export function auditConfigProblems(text: string): string[] {
  const lines = text
    .split("\n")
    .map(code)
    .filter((l) => l !== "");
  return lines.flatMap((line, i) => {
    if (!line.includes("auditConfig")) {
      return [];
    }
    const next = (lines[i + 1] ?? "").trimStart();
    return line === "auditConfig:" && !/^[{[]/.test(next)
      ? []
      : [
          `auditConfig dạng flow-mapping hay khoá lạ (${line.trim()}): viết dạng khối \`auditConfig:\` để kiểm được`,
        ];
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_TEXT = ["reason", "approved_by", "owner"];

// Ngày lịch có thật (UTC): `2026-13-45`, `2026-02-30` không qua round-trip `Date`.
export function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) {
    return false;
  }
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function readIds(workspace: string, key: string, errs: string[]): string[] {
  try {
    return ignoredIds(workspace, key);
  } catch (e) {
    errs.push((e as Error).message);
    return [];
  }
}

export function problems(workspace: string, exceptions: Exception[], today: string): string[] {
  const errs: string[] = auditConfigProblems(workspace);
  const ghsas = readIds(workspace, "ignoreGhsas", errs);
  const cves = readIds(workspace, "ignoreCves", errs);
  for (const e of exceptions) {
    const id = e.ghsa ?? e.cve ?? "?";
    const missing = KEYS.filter((k) => !(k in e));
    if (missing.length > 0) {
      errs.push(`${id}: thiếu khoá ${missing.join(", ")}`);
    }
    // `null`, "never", ngày sai dạng hay không có thật: không phải hạn — so chuỗi với hôm nay sẽ cho qua
    // ("never" > "2026-…"). Hạn và hôm nay đều theo UTC.
    if (!isRealDate(e.expires)) {
      errs.push(`${id}: expires phải là YYYY-MM-DD, có ${String(e.expires)}`);
    } else if (e.expires < today) {
      errs.push(`${id}: hết hạn ${e.expires}`);
    }
    for (const k of REQUIRED_TEXT) {
      if (k in e && (typeof e[k] !== "string" || String(e[k]).trim() === "")) {
        errs.push(`${id}: ${k} rỗng`);
      }
    }
    const used = (e.ghsa != null && ghsas.includes(e.ghsa)) || (e.cve != null && cves.includes(e.cve));
    if (!used) {
      errs.push(`${id}: ngoại lệ không còn được bỏ qua`);
    }
  }
  const orphans = [
    ...ghsas.filter((g) => !exceptions.some((e) => e.ghsa === g)),
    ...cves.filter((c) => !exceptions.some((e) => e.cve === c)),
  ];
  for (const o of orphans) {
    errs.push(`${o}: bỏ qua mà không có ngoại lệ`);
  }
  return errs;
}

if (import.meta.main) {
  const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
  const data = JSON.parse(readFileSync("audit-exceptions.json", "utf8")) as { exceptions: Exception[] };
  const errs = problems(workspace, data.exceptions, new Date().toISOString().slice(0, 10)); // ngày UTC
  for (const e of errs) {
    console.error(e);
  }
  process.exit(errs.length > 0 ? 1 : 0);
}
