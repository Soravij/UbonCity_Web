import pool from "../config/db.js";

let ensurePromise;

async function checkRoleColumnExists() {
  const [dbRows] = await pool.query("SELECT DATABASE() AS dbName");
  const dbName = dbRows?.[0]?.dbName;

  if (!dbName) return false;

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.columns
     WHERE table_schema = ?
       AND table_name = 'users'
       AND column_name = 'role'`,
    [dbName]
  );

  return Number(rows?.[0]?.total || 0) > 0;
}

export async function ensureUserRoleColumn() {
  if (ensurePromise) {
    return ensurePromise;
  }

  ensurePromise = (async () => {
    const exists = await checkRoleColumnExists();

    if (!exists) {
      await pool.query("ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'");
    }
  })();

  return ensurePromise;
}
