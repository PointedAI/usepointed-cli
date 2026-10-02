import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function owned(stat: fs.Stats): boolean {
  if (typeof process.getuid !== "function") {
    throw new Error("Private local files require POSIX ownership and permissions (macOS/Linux); Windows ACL validation is not supported.");
  }
  return stat.uid === process.getuid();
}

function assertOwnedDirectory(stat: fs.Stats): void {
  if (!stat.isDirectory() || !owned(stat)) throw new Error("Local storage must be an owned, non-symlink directory.");
}

/** Ancestors may be shared for reading, but cannot let another user swap paths. */
function assertTrustedAncestors(directory: string): void {
  let current = fs.realpathSync(directory);
  while (true) {
    const stat = fs.lstatSync(current);
    const rootOwned = typeof process.getuid === "function" && stat.uid === 0;
    const stickyRoot = rootOwned && (stat.mode & 0o1000) !== 0;
    if (!stat.isDirectory() || (!owned(stat) && !rootOwned) || ((stat.mode & 0o022) !== 0 && !stickyRoot)) {
      throw new Error("Local storage has an unsafe writable or unowned parent directory.");
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function verifiedDirectory(directory: string, create: boolean, privateMode: boolean): string | null {
  let resolved = path.resolve(directory);
  let stat: fs.Stats;
  try { stat = fs.lstatSync(resolved); }
  catch (error) {
    if (!missing(error)) throw error;
    if (!create) return null;
    const parent = path.dirname(resolved);
    if (parent === resolved) throw error;
    const canonicalParent = verifiedParent(parent);
    resolved = path.join(canonicalParent, path.basename(resolved));
    try { fs.mkdirSync(resolved, { mode: 0o700 }); }
    catch (creationError) { if ((creationError as NodeJS.ErrnoException).code !== "EEXIST") throw creationError; }
    stat = fs.lstatSync(resolved);
  }
  assertOwnedDirectory(stat);
  // Operate on this canonical path from now on. A lexical ancestor alias may
  // live in a writable directory and must not redirect a later read or write.
  const canonical = fs.realpathSync(resolved);
  stat = fs.lstatSync(canonical);
  assertOwnedDirectory(stat);
  assertTrustedAncestors(canonical);
  if ((stat.mode & (privateMode ? 0o077 : 0o022)) !== 0) {
    throw new Error(privateMode
      ? "Pointed state directory must be private (chmod 700 ~/.pointed)."
      : "Export output directory must not be writable by other users.");
  }
  return canonical;
}

function verifiedParent(directory: string): string {
  try {
    const canonical = fs.realpathSync(directory);
    assertTrustedAncestors(canonical);
    return canonical;
  } catch (error) {
    if (!missing(error)) throw error;
    return verifiedDirectory(directory, true, false)!;
  }
}

function assertPrivateFile(stat: fs.Stats): void {
  if (!stat.isFile() || !owned(stat) || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) {
    throw new Error("Pointed state must use owned, private regular files without links (mode 600).");
  }
}

function openStateFile(file: string): number | null {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); }
  catch (error) { if (missing(error)) return null; throw error; }
  assertPrivateFile(stat);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const actual = fs.fstatSync(fd);
    assertPrivateFile(actual);
    if (actual.dev !== stat.dev || actual.ino !== stat.ino) throw new Error("Pointed state changed while opening it.");
    return fd;
  } catch (error) { fs.closeSync(fd); throw error; }
}

export function readPrivateState(file: string): string | null {
  const directory = verifiedDirectory(path.dirname(file), false, true);
  if (!directory) return null;
  const fd = openStateFile(path.join(directory, path.basename(file)));
  if (fd === null) return null;
  try { return fs.readFileSync(fd, "utf8"); }
  finally { fs.closeSync(fd); }
}

export function writePrivateState(file: string, value: string): void {
  const directory = verifiedDirectory(path.dirname(file), true, true)!;
  file = path.join(directory, path.basename(file));
  const existing = openStateFile(file);
  if (existing !== null) fs.closeSync(existing);
  const temporary = path.join(path.dirname(file), `.pointed-${randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    assertPrivateFile(fs.fstatSync(fd));
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
  } catch (error) { fs.unlinkSync(temporary); throw error; }
  finally { fs.closeSync(fd); }
  try { fs.renameSync(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch (error) { if (!missing(error)) throw error; } }
}

export function removePrivateState(file: string): void {
  const directory = verifiedDirectory(path.dirname(file), false, true);
  if (!directory) return;
  file = path.join(directory, path.basename(file));
  const fd = openStateFile(file);
  if (fd === null) return;
  fs.closeSync(fd);
  fs.unlinkSync(file);
}

/** Every export gets a new private tree; existing exports are never reused. */
export function createPrivateExportDirectory(outputDirectory: string, prefix: string): string {
  const directory = verifiedDirectory(outputDirectory, true, false)!;
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error("Invalid export directory prefix.");
  const created = fs.mkdtempSync(path.join(directory, `${prefix}-`));
  fs.chmodSync(created, 0o700);
  verifiedDirectory(created, false, true);
  return created;
}

export function exportFilePath(directory: string, name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(name)) throw new Error("Invalid export file name.");
  return path.join(directory, name);
}

export function writePrivateExport(file: string, value: string | Uint8Array): void {
  const directory = verifiedDirectory(path.dirname(file), false, true);
  if (!directory) throw new Error("Export directory no longer exists.");
  file = path.join(directory, path.basename(file));
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.fchmodSync(fd, 0o600); assertPrivateFile(fs.fstatSync(fd)); fs.writeFileSync(fd, value); }
  finally { fs.closeSync(fd); }
}
