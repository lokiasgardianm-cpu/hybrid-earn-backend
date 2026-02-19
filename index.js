// Not used. Server runs from server.js


require("dotenv").config();
const { Telegraf } = require("telegraf");
const { Pool } = require("pg");
const express = require("express");
const cors = require("cors");

console.log("Bot starting...");

// ================= EXPRESS =================
const app = express();
app.use(cors());
app.use(express.json());

// ================= BOT =================
const bot = new Telegraf(process.env.BOT_TOKEN);

// ================= DATABASE =================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= BOT START =================
bot.start(async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const username = ctx.from.username || "";
    const refId = ctx.startPayload ? Number(ctx.startPayload) : null;

    console.log("User:", telegramId, "Ref:", refId);

    const userCheck = await pool.query(
      "SELECT * FROM users WHERE telegram_id=$1",
      [telegramId]
    );

    // ================= NEW USER =================
    if (userCheck.rows.length === 0) {

      await pool.query(
        "INSERT INTO users (telegram_id, username, referred_by, balance) VALUES ($1,$2,$3,0)",
        [telegramId, username, refId && refId !== telegramId ? refId : null]
      );

      // Referral Bonus
      if (refId && refId !== telegramId) {

        // Referrer balance +200
        await pool.query(
          "UPDATE users SET balance = balance + 200 WHERE telegram_id=$1",
          [refId]
        );

        // Referrer referrals +1
        await pool.query(
          "UPDATE users SET referrals = referrals + 1 WHERE telegram_id=$1",
          [refId]
        );
      }
    }

    // ================= OPEN MINI APP BUTTON =================
    await ctx.reply("🚀 Open App", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Open App",
              web_app: { url: process.env.MINI_APP_URL }
            }
          ]
        ]
      }
    });

  } catch (error) {
    console.log("Start Error:", error);
  }
});

// ================= API ROUTES =================

// Get user info
app.get("/user/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT telegram_id, username, balance, referrals, referred_by FROM users WHERE telegram_id=$1",
      [id]
    );

    res.json(result.rows[0] || {});
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get referral count (backup)
app.get("/referrals/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT COUNT(*) FROM users WHERE referred_by=$1",
      [id]
    );

    res.json({ total: result.rows[0].count });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Server error" });
  }
});

// Add balance (test)
app.post("/add-balance", async (req, res) => {
  try {
    const { id, amount } = req.body;

    await pool.query(
      "UPDATE users SET balance = balance + $1 WHERE telegram_id=$2",
      [amount, id]
    );

    res.json({ success: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Server error" });
  }
});

// ================= START SERVERS =================
bot.launch();
app.listen(3000, () => {
  console.log("API running on port 3000");
});


// Not used. Server runs from server.js
