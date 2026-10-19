
export function configureWritableSqlite(db, { journalMode = "delete" } = {}) {
  db.exec("PRAGMA busy_timeout = 0");
  db.exec("PRAGMA foreign_keys = ON");
  const mode = String(db.prepare(`PRAGMA journal_mode = ${journalMode}`).get().journal_mode).toLowerCase();
  if (mode !== journalMode) throw new Error(`SQLite journal mode is '${mode}', expected '${journalMode}'`);
  db.exec("PRAGMA synchronous = FULL");
}

export function configureReadableSqlite(db, { journalMode = "delete" } = {}) {
  db.exec("PRAGMA busy_timeout = 0");
  db.exec("PRAGMA foreign_keys = ON");
  const mode = String(db.prepare("PRAGMA journal_mode").get().journal_mode).toLowerCase();
  const allowed = journalMode === null ? ["delete", "wal"] : [journalMode];
  if (!allowed.includes(mode)) throw new Error(`SQLite journal mode is '${mode}', expected ${allowed.join(" or ")}`);
}

function sqliteCode(error) {
  return typeof error?.code === "string" ? error.code : null;
}

export function classifySqliteFailure(error) {
  const code = sqliteCode(error);
  if (["missing", "contention", "recovery_pending", "coordination_unusable", "failure"]
    .includes(code)) return code;
  if (code === "ERR_SQLITE_ERROR" && /SQLITE_(?:BUSY|LOCKED)/.test(error?.message ?? "")) {
    return "contention";
  }
  if (
    code === "SQLITE_BUSY" ||
    code === "SQLITE_LOCKED" ||
    /database is locked|database table is locked/i.test(error?.message ?? "")
  ) return "contention";
  if (
    code === "SQLITE_READONLY_ROLLBACK" ||
    /readonly.*rollback|hot journal|recovery.*pending/i.test(error?.message ?? "")
  ) return "recovery_pending";
  if (
    code === "SQLITE_CORRUPT" ||
    code === "SQLITE_NOTADB" ||
    /not a database|database disk image is malformed/i.test(error?.message ?? "")
  ) return "coordination_unusable";
  return "failure";
}

