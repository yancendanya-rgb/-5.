/* /api/orders — створення відкрите; перегляд, зміна статусу й видалення лише для адміністратора.
   Ціни береться з БД: суму, надіслану клієнтом, сервер ігнорує. */
"use strict";

const express = require("express");
const V = require("../validators");
const { HttpError, validationError, requireAdmin, parseId } = require("../http");

module.exports = function orderRoutes(db) {
  const router = express.Router();

  function loadOrder(id) {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    if (!order) { return null; }
    order.items = db.prepare(
      "SELECT menu_item_id, title, price, qty FROM order_items WHERE order_id = ? ORDER BY id"
    ).all(id);
    return order;
  }

  const createOrder = db.transaction((value) => {
    const lines = value.items.map(({ id, qty }) => {
      const item = db.prepare("SELECT id, title, price FROM menu_items WHERE id = ?").get(id);
      if (!item) { throw validationError({ items: "Позицію меню №" + id + " не знайдено." }); }
      return { ...item, qty };
    });
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const discount = value.useBonus ? Math.min(V.BONUS_POINTS, subtotal) : 0;
    const total = subtotal - discount;
    const info = db.prepare(
      `INSERT INTO orders (name, phone, pickup, payment, note, use_bonus, subtotal, discount, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(value.name, value.phone, value.pickup, value.payment, value.note, value.useBonus ? 1 : 0, subtotal, discount, total);
    const insertLine = db.prepare(
      "INSERT INTO order_items (order_id, menu_item_id, title, price, qty) VALUES (?, ?, ?, ?, ?)"
    );
    lines.forEach((l) => insertLine.run(info.lastInsertRowid, l.id, l.title, l.price, l.qty));
    return Number(info.lastInsertRowid);
  });

  router.post("/", (req, res) => {
    const { errors, value } = V.order(req.body);
    if (Object.keys(errors).length) { throw validationError(errors); }
    const id = createOrder(value);
    const order = loadOrder(id);
    // публічна відповідь без персональних даних, окрім номера й підсумку
    res.status(201).location("/api/orders/" + id).json({
      id: order.id, status: order.status, pickup: order.pickup,
      subtotal: order.subtotal, discount: order.discount, total: order.total,
      earnedPoints: Math.floor(order.total / 10), items: order.items
    });
  });

  router.get("/", requireAdmin, (req, res) => {
    const status = req.query.status;
    if (status !== undefined && !V.ORDER_STATUSES.includes(status)) { throw new HttpError(400, "Невідомий статус."); }
    const rows = status
      ? db.prepare("SELECT * FROM orders WHERE status = ? ORDER BY id DESC").all(status)
      : db.prepare("SELECT * FROM orders ORDER BY id DESC").all();
    res.json(rows);
  });

  router.get("/:id", requireAdmin, parseId, (req, res) => {
    const order = loadOrder(req.id);
    if (!order) { throw new HttpError(404, "Замовлення не знайдено."); }
    res.json(order);
  });

  router.patch("/:id", requireAdmin, parseId, (req, res) => {
    const status = req.body && req.body.status;
    if (!V.ORDER_STATUSES.includes(status)) {
      throw validationError({ status: "Статус має бути одним із: " + V.ORDER_STATUSES.join(", ") + "." });
    }
    const info = db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, req.id);
    if (!info.changes) { throw new HttpError(404, "Замовлення не знайдено."); }
    res.json(loadOrder(req.id));
  });

  router.delete("/:id", requireAdmin, parseId, (req, res) => {
    const info = db.prepare("DELETE FROM orders WHERE id = ?").run(req.id);
    if (!info.changes) { throw new HttpError(404, "Замовлення не знайдено."); }
    res.status(204).end();
  });

  return router;
};
