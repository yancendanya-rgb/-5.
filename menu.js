/* /api/menu — читання відкрите, зміни (POST/PUT/DELETE) лише для адміністратора. */
"use strict";

const express = require("express");
const V = require("../validators");
const { HttpError, validationError, requireAdmin, parseId } = require("../http");

module.exports = function menuRoutes(db) {
  const router = express.Router();
  const SORTS = {
    default: "position ASC, id ASC",
    "price-asc": "price ASC, id ASC",
    "price-desc": "price DESC, id ASC",
    name: "title COLLATE NOCASE ASC"
  };

  // GET /api/menu?category=kava&q=латте&sort=price-asc
  router.get("/", (req, res) => {
    const { category, q, sort } = req.query;
    const where = [];
    const params = {};
    if (category !== undefined) {
      if (!V.CATEGORIES.includes(category)) { throw new HttpError(400, "Невідома категорія."); }
      where.push("category = @category");
      params.category = category;
    }
    if (q !== undefined) {
      if (typeof q !== "string" || q.length > 60) { throw new HttpError(400, "Пошуковий запит задовгий."); }
      if (q.trim()) {
        where.push("(ulower(title) LIKE @q ESCAPE '\\' OR ulower(description) LIKE @q ESCAPE '\\')");
        params.q = "%" + q.trim().toLowerCase().replace(/[\\%_]/g, "\\$&") + "%";
      }
    }
    if (sort !== undefined && !Object.prototype.hasOwnProperty.call(SORTS, sort)) {
      throw new HttpError(400, "Невідомий тип сортування.");
    }
    // ORDER BY береться лише зі словника SORTS — користувацький рядок у SQL не потрапляє
    const sql = "SELECT * FROM menu_items" + (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY " + SORTS[sort || "default"];
    res.json(db.prepare(sql).all(params));
  });

  router.get("/:id", parseId, (req, res) => {
    const item = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.id);
    if (!item) { throw new HttpError(404, "Позицію меню не знайдено."); }
    res.json(item);
  });

  router.post("/", requireAdmin, (req, res) => {
    const { errors, value } = V.menuItem(req.body);
    if (Object.keys(errors).length) { throw validationError(errors); }
    const { m } = db.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM menu_items").get();
    const info = db.prepare(
      `INSERT INTO menu_items (category, title, price, description, image, image_alt, badge, allergens, position)
       VALUES (@category, @title, @price, @description, @image, @image_alt, @badge, @allergens, @position)`
    ).run({ ...value, position: m + 1 });
    res.status(201).location("/api/menu/" + info.lastInsertRowid)
      .json(db.prepare("SELECT * FROM menu_items WHERE id = ?").get(info.lastInsertRowid));
  });

  router.put("/:id", requireAdmin, parseId, (req, res) => {
    if (!db.prepare("SELECT 1 FROM menu_items WHERE id = ?").get(req.id)) {
      throw new HttpError(404, "Позицію меню не знайдено.");
    }
    const { errors, value } = V.menuItem(req.body);
    if (Object.keys(errors).length) { throw validationError(errors); }
    db.prepare(
      `UPDATE menu_items SET category=@category, title=@title, price=@price, description=@description,
       image=@image, image_alt=@image_alt, badge=@badge, allergens=@allergens WHERE id=@id`
    ).run({ ...value, id: req.id });
    res.json(db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.id));
  });

  router.delete("/:id", requireAdmin, parseId, (req, res) => {
    const info = db.prepare("DELETE FROM menu_items WHERE id = ?").run(req.id);
    if (!info.changes) { throw new HttpError(404, "Позицію меню не знайдено."); }
    res.status(204).end();
  });

  return router;
};
