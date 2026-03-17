import path from "node:path";

export function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export function normalizeRelDir(rel: string): string {
  let r = rel.trim();
  if (!r) return "";
  r = r.replace(/^[.][\\/]/, "");
  r = toPosixPath(r);
  r = r.replace(/\/+$/, "");
  return r;
}

export function isSubpath(parentAbs: string, childAbs: string): boolean {
  const rel = path.relative(parentAbs, childAbs);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function isWithinOrEqual(parentAbs: string, childAbs: string): boolean {
  if (path.resolve(parentAbs) === path.resolve(childAbs)) return true;
  const rel = path.relative(parentAbs, childAbs);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function isIgnored(absFile: string, rootDirAbs: string, ignoreDirsRel: string[]): boolean {
  const rel = toPosixPath(path.relative(rootDirAbs, absFile));
  if (rel.startsWith("..")) return true;
  for (const ign of ignoreDirsRel) {
    if (!ign) continue;
    if (rel === ign) return true;
    if (rel.startsWith(ign + "/")) return true;
  }
  return false;
}
