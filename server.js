/* Точка входу: npm start */
"use strict";

require("dotenv").config({ quiet: true });
const { openDatabase, seedMenu } = require("./db");
const { createApp } = require("./app");

const db = openDatabase();
const added = seedMenu(db);
if (added) { console.log("Меню заповнено початковими даними: " + added + " позицій."); }

const port = Number(process.env.PORT) || 3000;
const server = createApp(db).listen(port, () => {
  console.log("Затишна кава: http://localhost:" + port +
    (process.env.ADMIN_TOKEN ? "" : "  (ADMIN_TOKEN не задано — адмін-API вимкнено)"));
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
