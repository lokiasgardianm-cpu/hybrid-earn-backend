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
        "INSERT INTO users (telegram_id, username, balance, referrals, referred_by) VALUES ($1,$2,$3,0,$4)",
        [
          telegramId,
          username,
          200, // New user join bonus
          refId && refId !== telegramId ? refId : null
        ]
      );

      // ===== REFERRAL BONUS =====
      if (refId && refId !== telegramId) {

        const refCheck = await pool.query(
          "SELECT telegram_id FROM users WHERE telegram_id=$1",
          [refId]
        );

        if (refCheck.rows.length > 0) {

          await pool.query(
            "UPDATE users SET balance = balance + 1000, referrals = referrals + 1 WHERE telegram_id=$1",
            [refId]
          );

          await pool.query(
            "INSERT INTO referral_logs (referrer_id, from_user_id, amount, type) VALUES ($1,$2,$3,$4)",
            [refId, telegramId, 1000, "join_bonus"]
          );

        }
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


// ===== TAP ROUTE =====
app.post("/tap", async (req, res) => {
  try {
    const { id, amount } = req.body;

    // 🔒 Basic validation
    if (!id || typeof amount !== "number") {
      return res.status(400).json({ error: "Invalid request" });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (amount > 500) {
      return res.status(400).json({ error: "Amount too large" });
    }

    // ===== TAP ROUTE (PG VERSION) =====
    app.post("/tap", async (req, res) => {
      try {
        const { id, amount } = req.body;

        if (!id || typeof amount !== "number") {
          return res.status(400).json({ error: "Invalid request" });
        }

        if (amount <= 0) {
          return res.status(400).json({ error: "Invalid amount" });
        }

        if (amount > 500) {
          return res.status(400).json({ error: "Amount too large" });
        }

        const userResult = await pool.query(
          "SELECT balance FROM users WHERE telegram_id = $1",
          [id]
        );

        if (userResult.rows.length === 0) {
          return res.status(400).json({ error: "User not found" });
        }

        const currentBalance = userResult.rows[0].balance;
        const newBalance = currentBalance + amount;

        await pool.query(
          "UPDATE users SET balance = $1 WHERE telegram_id = $2",
          [newBalance, id]
        );

        res.json({
          success: true,
          balance: newBalance
        });

      } catch (error) {
        console.log("Tap error:", error);
        res.status(500).json({ error: "Server error" });
      }
    });


    // 2️⃣ Increase balance
    const newBalance = user.balance + amount;

    const { error: updateError } = await supabase
      .from("users")
      .update({ balance: newBalance })
      .eq("telegram_id", id);

    if (updateError) {
      return res.status(500).json({ error: "Update failed" });
    }

    // 3️⃣ Send response
    res.json({
      success: true,
      balance: newBalance
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Server error" });
  }
});





// ===== GET USER DATA =====
app.get("/user/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT telegram_id, balance, referrals, referral_earnings FROM users WHERE telegram_id=$1",
      [req.params.id]
    );

    res.json(result.rows[0] || {});
  } catch (error) {
    console.log("User Fetch Error:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// ===== GET REFERRAL LIST =====
app.get("/referrals/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT telegram_id, username, balance FROM users WHERE referred_by=$1",
      [req.params.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.log("Referral list error:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// ===== GET REFERRAL HISTORY =====
app.get("/referral-history/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM referral_logs WHERE referrer_id=$1 ORDER BY created_at DESC",
      [req.params.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.log("Referral history error:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// ===== AD REWARD + 5% REFERRAL BONUS =====
app.post("/reward-ad", async (req, res) => {
  try {
    const { id } = req.body;
    const AD_REWARD = 75;

    if (!id) {
      return res.status(400).json({ error: "Invalid request" });
    }

    // ✅ Check user exists
    const userCheck = await pool.query(
      "SELECT telegram_id FROM users WHERE telegram_id=$1",
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(400).json({ error: "User not found" });
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

      await pool.query(
        "INSERT INTO referral_logs (referrer_id, from_user_id, amount, type) VALUES ($1,$2,$3,$4)",
        [referrerId, id, bonus, "ad_bonus"]
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




