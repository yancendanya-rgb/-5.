/* База даних SQLite (better-sqlite3): підключення, схема таблиць, початкові дані. */
"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS menu_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT    NOT NULL CHECK (category IN ('kava','tea','cold','food','dessert')),
  title       TEXT    NOT NULL,
  price       INTEGER NOT NULL CHECK (price > 0),
  description TEXT    NOT NULL DEFAULT '',
  image       TEXT    NOT NULL DEFAULT '',
  image_alt   TEXT    NOT NULL DEFAULT '',
  badge       TEXT    NOT NULL DEFAULT '',
  allergens   TEXT    NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  phone      TEXT    NOT NULL,
  pickup     TEXT    NOT NULL,
  payment    TEXT    NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  use_bonus  INTEGER NOT NULL DEFAULT 0,
  subtotal   INTEGER NOT NULL,
  discount   INTEGER NOT NULL DEFAULT 0,
  total      INTEGER NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new','preparing','ready','done','cancelled')),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  title        TEXT    NOT NULL,
  price        INTEGER NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 20)
);

CREATE TABLE IF NOT EXISTS bookings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT    NOT NULL,
  time       TEXT    NOT NULL,
  guests     INTEGER NOT NULL CHECK (guests BETWEEN 1 AND 8),
  name       TEXT    NOT NULL,
  phone      TEXT    NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings (date, time);

CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  email      TEXT    NOT NULL,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  message    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
`;

function openDatabase(file) {
  const target = file || process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "zatyshna.db");
  if (target !== ":memory:") {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new Database(target);
  db.pragma("foreign_keys = ON");
  // SQLite LIKE не ігнорує регістр для кирилиці, тому пошук виконується через власну функцію
  db.function("ulower", { deterministic: true }, (value) => String(value).toLowerCase());
  if (target !== ":memory:") { db.pragma("journal_mode = WAL"); }
  db.exec(SCHEMA);
  return db;
}

/* Початкові дані меню: заповнюємо лише порожню таблицю */
function seedMenu(db, { reset = false } = {}) {
  const items = require("./data/menu.seed.json");
  if (reset) {
    db.exec("DELETE FROM order_items; DELETE FROM menu_items; DELETE FROM sqlite_sequence WHERE name IN ('menu_items','order_items');");
  }
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM menu_items").get();
  if (n > 0) { return 0; }
  const insert = db.prepare(
    `INSERT INTO menu_items (category, title, price, description, image, image_alt, badge, allergens, position)
     VALUES (@category, @title, @price, @description, @image, @image_alt, @badge, @allergens, @position)`
  );
  db.transaction((rows) => rows.forEach((r) => insert.run(r)))(items);
  return items.length;
}

module.exports = { openDatabase, seedMenu };
