/* Автоматичні тести REST API (node --test). БД — у пам'яті, окрема на кожен запуск. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { openDatabase, seedMenu } = require("../server/db");
const { createApp } = require("../server/app");
const V = require("../server/validators");

process.env.ADMIN_TOKEN = "test-token";
const ADMIN = { Authorization: "Bearer test-token" };

function futureDate(days) {
  return V.nowInKyiv(new Date(Date.now() + days * 86400000)).date;
}

async function start(options) {
  const db = openDatabase(":memory:");
  seedMenu(db);
  const server = createApp(db, { rateLimiting: false, ...options }).listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* не JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  return { db, call, base, close: () => new Promise((r) => { server.close(r); db.close(); }) };
}

/* ---------- Меню: читання ---------- */
test("GET /api/menu повертає всі 16 позицій; фільтр, пошук і сортування працюють", async (t) => {
  const s = await start(); t.after(s.close);
  const all = await s.call("GET", "/api/menu");
  assert.equal(all.status, 200);
  assert.equal(all.json.length, 16);

  const tea = await s.call("GET", "/api/menu?category=tea");
  assert.ok(tea.json.length > 0 && tea.json.every((i) => i.category === "tea"));

  const sorted = await s.call("GET", "/api/menu?sort=price-asc");
  const prices = sorted.json.map((i) => i.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));

  const found = await s.call("GET", "/api/menu?q=" + encodeURIComponent("капучино"));
  assert.ok(found.json.some((i) => i.title === "Капучино"));
});

test("GET /api/menu відхиляє некоректні параметри (400) і не піддається SQL-ін'єкції", async (t) => {
  const s = await start(); t.after(s.close);
  assert.equal((await s.call("GET", "/api/menu?category=wine")).status, 400);
  assert.equal((await s.call("GET", "/api/menu?sort=price;DROP TABLE menu_items")).status, 400);
  const inj = await s.call("GET", "/api/menu?q=" + encodeURIComponent("' OR 1=1 --"));
  assert.equal(inj.status, 200);
  assert.equal(inj.json.length, 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM menu_items").get().n, 16);
});

test("GET /api/menu/:id: знайдено, не знайдено, некоректний id", async (t) => {
  const s = await start(); t.after(s.close);
  assert.equal((await s.call("GET", "/api/menu/1")).json.id, 1);
  assert.equal((await s.call("GET", "/api/menu/9999")).status, 404);
  assert.equal((await s.call("GET", "/api/menu/abc")).status, 400);
});

/* ---------- Меню: CRUD для адміністратора ---------- */
test("CRUD меню: без токена — 401, з токеном — повний цикл", async (t) => {
  const s = await start(); t.after(s.close);
  const item = { title: "Мокачино", category: "kava", price: 99, description: "Кава з шоколадом", allergens: "молоко" };

  assert.equal((await s.call("POST", "/api/menu", item)).status, 401);
  assert.equal((await s.call("POST", "/api/menu", item, { Authorization: "Bearer wrong" })).status, 401);

  const created = await s.call("POST", "/api/menu", item, ADMIN);
  assert.equal(created.status, 201);
  assert.match(created.headers.get("location"), /^\/api\/menu\/\d+$/);
  const id = created.json.id;

  const updated = await s.call("PUT", "/api/menu/" + id, { ...item, price: 105 }, ADMIN);
  assert.equal(updated.status, 200);
  assert.equal(updated.json.price, 105);
  assert.equal((await s.call("GET", "/api/menu/" + id)).json.price, 105);

  assert.equal((await s.call("DELETE", "/api/menu/" + id, undefined, ADMIN)).status, 204);
  assert.equal((await s.call("GET", "/api/menu/" + id)).status, 404);
  assert.equal((await s.call("DELETE", "/api/menu/" + id, undefined, ADMIN)).status, 404);
});

test("POST /api/menu: помилки валідації повертають 422 з описом полів", async (t) => {
  const s = await start(); t.after(s.close);
  const r = await s.call("POST", "/api/menu", { title: "", category: "wine", price: -5, image: "http://evil.example/x.js" }, ADMIN);
  assert.equal(r.status, 422);
  for (const f of ["title", "category", "price", "image"]) { assert.ok(r.json.errors[f], "немає помилки для " + f); }
});

test("Адмін-маршрути вимкнені, якщо ADMIN_TOKEN не задано", async (t) => {
  const s = await start(); t.after(s.close);
  const saved = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  try {
    assert.equal((await s.call("GET", "/api/orders", undefined, ADMIN)).status, 503);
  } finally { process.env.ADMIN_TOKEN = saved; }
});

/* ---------- Замовлення ---------- */
const validOrder = (extra = {}) => ({
  name: "Ірина", phone: "0671234567", pickup: "asap", payment: "on-site", note: "",
  useBonus: false, items: [{ id: 2, qty: 2 }, { id: 1, qty: 1 }], ...extra
});

test("POST /api/orders: сервер сам рахує суму за цінами з БД", async (t) => {
  const s = await start(); t.after(s.close);
  const price = (id) => s.db.prepare("SELECT price FROM menu_items WHERE id=?").get(id).price;
  // клієнт намагається підсунути свою суму та ціни — вони ігноруються
  const r = await s.call("POST", "/api/orders", validOrder({ total: 1, subtotal: 1, items: [{ id: 2, qty: 2, price: 1 }, { id: 1, qty: 1 }] }));
  assert.equal(r.status, 201);
  assert.equal(r.json.subtotal, price(2) * 2 + price(1));
  assert.equal(r.json.total, r.json.subtotal);
  assert.equal(r.json.earnedPoints, Math.floor(r.json.total / 10));
  assert.equal(r.json.phone, undefined, "публічна відповідь не містить телефону");
  assert.equal(s.db.prepare("SELECT phone FROM orders WHERE id=?").get(r.json.id).phone, "+380671234567");
});

test("POST /api/orders: знижка балами не перевищує суму", async (t) => {
  const s = await start(); t.after(s.close);
  const big = await s.call("POST", "/api/orders", validOrder({ useBonus: true }));
  assert.equal(big.json.discount, Math.min(V.BONUS_POINTS, big.json.subtotal));
  assert.equal(big.json.total, big.json.subtotal - big.json.discount);
  const cheapId = s.db.prepare("SELECT id FROM menu_items ORDER BY price LIMIT 1").get().id;
  const small = await s.call("POST", "/api/orders", validOrder({ useBonus: true, items: [{ id: cheapId, qty: 1 }] }));
  assert.ok(small.json.total >= 0);
});

test("POST /api/orders: некоректні дані → 422 і нічого не записується", async (t) => {
  const s = await start(); t.after(s.close);
  const bad = [
    [validOrder({ name: "1" }), "name"],
    [validOrder({ phone: "12345" }), "phone"],
    [validOrder({ pickup: "03:00" }), "pickup"],
    [validOrder({ payment: "bitcoin" }), "payment"],
    [validOrder({ items: [] }), "items"],
    [validOrder({ items: [{ id: 1, qty: 0 }] }), "items"],
    [validOrder({ items: [{ id: 1, qty: 21 }] }), "items"],
    [validOrder({ items: [{ id: 1, qty: "abc" }] }), "items"],
    [validOrder({ items: [{ id: 999, qty: 1 }] }), "items"],
    [validOrder({ note: "x".repeat(201) }), "note"]
  ];
  for (const [body, field] of bad) {
    const r = await s.call("POST", "/api/orders", body);
    assert.equal(r.status, 422, "очікували 422 для поля " + field);
    assert.ok(r.json.errors[field], "немає помилки для " + field);
  }
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM orders").get().n, 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM order_items").get().n, 0);
});

test("Замовлення: перегляд і зміна статусу — лише адміністратор; видалення позиції меню не ламає замовлення", async (t) => {
  const s = await start(); t.after(s.close);
  const { json: order } = await s.call("POST", "/api/orders", validOrder());
  assert.equal((await s.call("GET", "/api/orders/" + order.id)).status, 401);

  const got = await s.call("GET", "/api/orders/" + order.id, undefined, ADMIN);
  assert.equal(got.json.items.length, 2);
  assert.equal(got.json.status, "new");

  assert.equal((await s.call("PATCH", "/api/orders/" + order.id, { status: "ready" }, ADMIN)).json.status, "ready");
  assert.equal((await s.call("PATCH", "/api/orders/" + order.id, { status: "hacked" }, ADMIN)).status, 422);
  assert.equal((await s.call("GET", "/api/orders?status=ready", undefined, ADMIN)).json.length, 1);

  await s.call("DELETE", "/api/menu/1", undefined, ADMIN);
  const after = await s.call("GET", "/api/orders/" + order.id, undefined, ADMIN);
  assert.ok(after.json.items.some((i) => i.menu_item_id === null && i.title), "знімок назви й ціни збережено");

  assert.equal((await s.call("DELETE", "/api/orders/" + order.id, undefined, ADMIN)).status, 204);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM order_items").get().n, 0, "позиції видаляються каскадом");
});

/* ---------- Бронювання ---------- */
test("Бронювання: слоти, створення, 409 при зайнятому часі, скасування", async (t) => {
  const s = await start(); t.after(s.close);
  const date = futureDate(3);
  const body = (extra = {}) => ({ date, time: "14:00", guests: 2, name: "Олег", phone: "+380 67 123 45 67", note: "", ...extra });

  const before = await s.call("GET", "/api/bookings/slots?date=" + date);
  assert.equal(before.json.slots.length, 20);
  assert.ok(before.json.slots.every((x) => x.available));

  const ids = [];
  for (let i = 0; i < 3; i++) {
    const r = await s.call("POST", "/api/bookings", body());
    assert.equal(r.status, 201);
    ids.push(r.json.id);
  }
  const full = await s.call("POST", "/api/bookings", body());
  assert.equal(full.status, 409);

  const after = await s.call("GET", "/api/bookings/slots?date=" + date);
  assert.equal(after.json.slots.find((x) => x.time === "14:00").available, false);
  assert.equal(after.json.slots.find((x) => x.time === "14:30").available, true);

  assert.equal((await s.call("GET", "/api/bookings", undefined)).status, 401);
  assert.equal((await s.call("DELETE", "/api/bookings/" + ids[0], undefined, ADMIN)).status, 204);
  assert.equal((await s.call("POST", "/api/bookings", body())).status, 201, "після скасування слот знову вільний");
});

test("Бронювання: некоректні дата, час, гості → 422; дата в минулому відхиляється", async (t) => {
  const s = await start(); t.after(s.close);
  const ok = { date: futureDate(2), time: "12:00", guests: 2, name: "Анна", phone: "0501234567" };
  const cases = [
    [{ date: "2020-01-01" }, "date"],
    [{ date: "2026-02-30" }, "date"],
    [{ date: "завтра" }, "date"],
    [{ date: futureDate(61) }, "date"],
    [{ time: "03:00" }, "time"],
    [{ guests: 9 }, "guests"],
    [{ guests: 0 }, "guests"],
    [{ phone: "abc" }, "phone"]
  ];
  for (const [patch, field] of cases) {
    const r = await s.call("POST", "/api/bookings", { ...ok, ...patch });
    assert.equal(r.status, 422, JSON.stringify(patch));
    assert.ok(r.json.errors[field]);
  }
  assert.equal((await s.call("GET", "/api/bookings/slots?date=bad")).status, 400);
});

test("Бронювання: час, що вже минув сьогодні, відхиляється (перевірка за київським часом)", () => {
  const now = new Date("2026-11-15T10:00:00Z"); // 12:00 за Києвом
  const r = V.booking({ date: "2026-11-15", time: "11:30", guests: 2, name: "Анна", phone: "0501234567" }, now);
  assert.ok(r.errors.time);
  const later = V.booking({ date: "2026-11-15", time: "12:30", guests: 2, name: "Анна", phone: "0501234567" }, now);
  assert.equal(later.errors.time, undefined);
});

/* ---------- Відгуки ---------- */
test("Відгуки: створення, валідація, доступ лише адміністратору", async (t) => {
  const s = await start(); t.after(s.close);
  const ok = { name: "Марія", email: "Maria@Example.com", rating: 5, message: "Дуже смачна кава, дякую!" };
  const r = await s.call("POST", "/api/feedback", ok);
  assert.equal(r.status, 201);
  assert.equal(s.db.prepare("SELECT email FROM feedback").get().email, "maria@example.com");

  for (const [patch, field] of [[{ email: "abc" }, "email"], [{ rating: 6 }, "rating"], [{ message: "коротко" }, "message"], [{ name: "" }, "name"]]) {
    const bad = await s.call("POST", "/api/feedback", { ...ok, ...patch });
    assert.equal(bad.status, 422);
    assert.ok(bad.json.errors[field]);
  }
  assert.equal((await s.call("GET", "/api/feedback")).status, 401);
  assert.equal((await s.call("GET", "/api/feedback", undefined, ADMIN)).json.length, 1);
});

test("XSS-рядки зберігаються як текст (екранування виконує клієнт через textContent)", async (t) => {
  const s = await start(); t.after(s.close);
  const payload = "<script>alert(1)</script> Привіт";
  const r = await s.call("POST", "/api/feedback", { name: "Тест", email: "t@example.com", rating: 3, message: payload });
  assert.equal(r.status, 201);
  assert.equal(s.db.prepare("SELECT message FROM feedback").get().message, payload);
  const name = await s.call("POST", "/api/feedback", { name: "<img src=x onerror=alert(1)>", email: "t@example.com", rating: 3, message: payload });
  assert.equal(name.status, 422, "ім'я з HTML-тегами відхиляється правилом personName");
});

/* ---------- Загальна поведінка сервера ---------- */
test("Помилки: некоректний JSON → 400, завелике тіло → 413, невідомий маршрут → 404 JSON", async (t) => {
  const s = await start(); t.after(s.close);
  assert.equal((await s.call("POST", "/api/feedback", "{ це не json")).status, 400);
  assert.equal((await s.call("POST", "/api/feedback", { message: "x".repeat(20000) })).status, 413);
  const nf = await s.call("GET", "/api/unknown");
  assert.equal(nf.status, 404);
  assert.ok(nf.json.error);
});

test("Заголовки безпеки: CSP, nosniff, відсутність X-Powered-By", async (t) => {
  const s = await start(); t.after(s.close);
  const r = await s.call("GET", "/menu.html");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
  assert.doesNotMatch(r.headers.get("content-security-policy"), /unsafe-inline/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-powered-by"), null);
});

test("Статичні файли: шляхи за межі public не віддаються", async (t) => {
  const s = await start(); t.after(s.close);
  const res = await fetch(s.base + "/..%2f..%2fpackage.json");
  assert.notEqual(res.status, 200);
  const env = await fetch(s.base + "/.env");
  assert.notEqual(env.status, 200);
});

test("Обмеження частоти запитів: після ліміту — 429", async (t) => {
  const s = await start({ rateLimiting: true, writeLimit: 3 }); t.after(s.close);
  const body = { name: "Марія", email: "m@example.com", rating: 5, message: "Дуже смачна кава!" };
  const codes = [];
  for (let i = 0; i < 5; i++) { codes.push((await s.call("POST", "/api/feedback", body)).status); }
  assert.deepEqual(codes, [201, 201, 201, 429, 429]);
});
