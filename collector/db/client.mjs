import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { assertAssignmentStateMigrationApplied, assertPlaceReviewFlagMigrationApplied } from "./workflow-head-schema.mjs";

export const MIN_PASSWORD_LENGTH = 8;
const WEAK_PASSWORDS = new Set(["admin", "admin1234", "password", "password123", "changeme", "123456", "12345678", "qwerty", "letmein"]);
const UPPERCASE_PASSWORD_PATTERN = /[A-Z]/;
const SPECIAL_PASSWORD_PATTERN = /[^A-Za-z0-9\s]/;
export const PASSWORD_POLICY_SUMMARY = `at least ${MIN_PASSWORD_LENGTH} characters, including 1 uppercase letter and 1 special character`;

export function validateStrongPassword(candidate) {
  const password = String(candidate || "");
  const normalized = password.trim().toLowerCase();

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }

  if (!UPPERCASE_PASSWORD_PATTERN.test(password)) {
    return { ok: false, error: "password must include at least 1 uppercase letter" };
  }

  if (!SPECIAL_PASSWORD_PATTERN.test(password)) {
    return { ok: false, error: "password must include at least 1 special character" };
  }

  if (WEAK_PASSWORDS.has(normalized)) {
    return { ok: false, error: "password is too weak" };
  }

  return { ok: true };
}

export function openDatabase(dbPath, schemaPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys = ON;");

    if (schemaPath) {
      const schemaSql = fs.readFileSync(schemaPath, "utf8").replace(/^\uFEFF/, "");
      db.exec(schemaSql);
    }

    assertPlaceReviewFlagMigrationApplied(db, "opening Collector");
    assertAssignmentStateMigrationApplied(db, "opening Collector");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}



