require("dotenv").config();
const express = require("express");
const { Telegraf } = require("telegraf");
const { Pool } = require("pg");
const cors = require("cors");

console.log("🚀 Server Starting...");

const app = express();
app.use(express.json());
app.use(cors());

// ===== TELEGRAM BOT =====
const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== SUPABASE (POSTGRES) =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= BOT START =================
bot.start(async (ctx) => {
  try {
    const telegramId = ctx.from.id.toString();
    const username = ctx.from.username || "";
    const refId = ctx.startPayload ? ctx.startPayload.toString() : null;

    console.log("User:", telegramId, "Ref:", refId);

    const userCheck = await pool.query(
      "SELECT * FROM users WHERE telegram_id=$1",
      [telegramId]
    );

    // ===== NEW USER =====
    if (userCheck.rows.length === 0) {

      await pool.query(
        "INSERT INTO users (telegram_id, username, balance, referrals, referred_by) VALUES ($1,$2,0,0,$3)",
        [telegramId, username, refId && refId !== telegramId ? refId : null]
      );

      // Referral bonus
      if (refId && refId !== telegramId) {
        await pool.query(
          "UPDATE users SET balance = balance + 1000, referrals = referrals + 1 WHERE telegram_id=$1",
          [refId]
        );
      }
    }

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

// Get User Data
app.get("/user/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT telegram_id, balance, referrals FROM users WHERE telegram_id=$1",
      [req.params.id]
    );

    res.json(result.rows[0] || {});
  } catch (error) {
    console.log("User Fetch Error:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// Ad Reward + 5% Referral Bonus
app.post("/reward-ad", async (req, res) => {
  try {
    const { id } = req.body;
    const AD_REWARD = 75;

    if (!id) {
      return res.status(400).json({ error: "Invalid request" });
    }

    // User reward
    await pool.query(
      "UPDATE users SET balance = balance + $1 WHERE telegram_id=$2",
      [AD_REWARD, id]
    );

    // Get referrer
    const result = await pool.query(
      "SELECT referred_by FROM users WHERE telegram_id=$1",
      [id]
    );

    const referrerId = result.rows[0]?.referred_by;

    if (referrerId) {
      const bonus = Math.floor(AD_REWARD * 0.05);

      await pool.query(
        "UPDATE users SET balance = balance + $1, referral_earnings = referral_earnings + $1 WHERE telegram_id=$2",
        [bonus, referrerId]
      );
    }

    res.json({ success: true });

  } catch (error) {
    console.log("Reward Ad Error:", error);
    res.status(500).json({ error: "Server error" });
  }
});





// ================= START SERVER =================
bot.launch();
app.listen(5000, () => {
  console.log("✅ API running on port 5000");
});
