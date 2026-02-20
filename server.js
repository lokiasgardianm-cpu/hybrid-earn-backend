require("dotenv").config();
const express = require("express");
const { Telegraf } = require("telegraf");
const { Pool } = require("pg");
const cors = require("cors");
const crypto = require("crypto");








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



function verifyTelegramWebApp(initData) {
  const botToken = process.env.BOT_TOKEN;

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get("hash");
  urlParams.delete("hash");

  const dataCheckArr = [];

  urlParams.sort();

  for (const [key, value] of urlParams.entries()) {
    dataCheckArr.push(`${key}=${value}`);
  }

  const dataCheckString = dataCheckArr.join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return calculatedHash === hash;
}


function verifyTelegramUser(req, res, next) {
  const initData = req.body.initData || req.headers["x-telegram-init-data"];

  if (!initData) {
    return res.status(401).json({ error: "No initData provided" });
  }

  const isValid = verifyTelegramWebApp(initData);

  if (!isValid) {
    return res.status(401).json({ error: "Invalid Telegram data" });
  }

  const urlParams = new URLSearchParams(initData);
  const user = JSON.parse(urlParams.get("user"));

  req.telegramUser = user;

  next();
}

// ===== TAP ANTI-CHEAT MEMORY STORE =====
const tapTracker = new Map();


// ================= API ROUTES =================


// ===== TAP ROUTE (CLEAN PG VERSION) =====

// ===== SECURE TAP ROUTE =====
app.post("/tap", verifyTelegramUser, async (req, res) => {
  try {
    const { amount } = req.body;
    const telegramId = req.telegramUser.id.toString();




    // ===== ANTI-CHEAT START =====
    const now = Date.now();

    if (!tapTracker.has(telegramId)) {
      tapTracker.set(telegramId, {
        lastTap: now,
        tapCount: 1,
        firstTapTime: now
      });
    } else {
      const data = tapTracker.get(telegramId);

      // Minimum interval 250ms
      if (now - data.lastTap < 250) {
        return res.status(429).json({
          success: false,
          message: "Too fast"
        });
      }

      // Reset counter every 1 second
      if (now - data.firstTapTime > 1000) {
        data.tapCount = 0;
        data.firstTapTime = now;
      }

      data.tapCount++;

      // Max 5 taps per second
      if (data.tapCount > 5) {
        return res.status(429).json({
          success: false,
          message: "Tap limit exceeded"
        });
      }

      data.lastTap = now;
      tapTracker.set(telegramId, data);
    }
    // ===== ANTI-CHEAT END =====








    // Basic validation
    if (!amount || typeof amount !== "number") {
      return res.status(400).json({ error: "Invalid request" });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (amount > 50) {   // Max tap limit per request
      return res.status(400).json({ error: "Tap amount too large" });
    }





    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        "SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE",
        [telegramId]
      );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "User not found" });
      }

      const currentBalance = Number(result.rows[0].balance);
      const newBalance = currentBalance + amount;

      // Insert transaction log
      await client.query(
        `INSERT INTO transactions 
    (user_id, type, amount, balance_before, balance_after, source)
    VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          telegramId,
          "tap",
          amount,
          currentBalance,
          newBalance,
          "/tap"
        ]
      );

      await client.query(
        "UPDATE users SET balance = $1 WHERE telegram_id = $2",
        [newBalance, telegramId]
      );

      await client.query("COMMIT");

      res.json({
        success: true,
        balance: newBalance
      });

    } catch (err) {
      await client.query("ROLLBACK");
      console.log("Tap TX error:", err);
      res.status(500).json({ error: "Transaction failed" });
    } finally {
      client.release();
    }






    res.json({
      success: true,
      balance: newBalance
    });

  } catch (error) {
    console.log("Tap error:", error);
    res.status(500).json({ error: "Server error" });
  }
});






// ===== GET USER DATA =====
app.get("/user/:id", verifyTelegramUser, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id.toString();

    if (telegramId !== req.params.id) {
      return res.status(403).json({ error: "Unauthorized access" });
    }

    const result = await pool.query(
      "SELECT telegram_id, balance, referrals, referral_earnings FROM users WHERE telegram_id=$1",
      [telegramId]
    );

    res.json(result.rows[0] || {});
  } catch (error) {
    console.log("User Fetch Error:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// ===== GET REFERRAL LIST =====
app.get("/referrals/:id", verifyTelegramUser, async (req, res) => {
  try {

    const telegramId = req.telegramUser.id.toString();

    if (telegramId !== req.params.id) {
      return res.status(403).json({ error: "Unauthorized access" });
    }


    const result = await pool.query(
      "SELECT telegram_id, username, balance FROM users WHERE referred_by=$1",
      [telegramId]
    );

    res.json(result.rows);
  } catch (error) {
    console.log("Referral list error:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// ===== GET REFERRAL HISTORY =====
app.get("/referral-history/:id", verifyTelegramUser, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id.toString();

    if (telegramId !== req.params.id) {
      return res.status(403).json({ error: "Unauthorized access" });
    }

    const result = await pool.query(
      "SELECT * FROM referral_logs WHERE referrer_id=$1 ORDER BY created_at DESC",
      [telegramId]
    );

    res.json(result.rows);
  } catch (error) {
    console.log("Referral history error:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// ===== AD REWARD + 5% REFERRAL BONUS =====
// ===== SECURE AD REWARD =====
app.post("/reward-ad", verifyTelegramUser, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id.toString();
    const AD_REWARD = 75;

    // User check
    const userCheck = await pool.query(
      "SELECT referred_by FROM users WHERE telegram_id=$1",
      [telegramId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(400).json({ error: "User not found" });
    }

    // Add reward to user
    await pool.query(
      "UPDATE users SET balance = balance + $1 WHERE telegram_id=$2",
      [AD_REWARD, telegramId]
    );

    const referrerId = userCheck.rows[0].referred_by;

    // 5% referral bonus
    if (referrerId) {
      const bonus = Math.floor(AD_REWARD * 0.05);

      await pool.query(
        "UPDATE users SET balance = balance + $1, referral_earnings = referral_earnings + $1 WHERE telegram_id=$2",
        [bonus, referrerId]
      );

      await pool.query(
        "INSERT INTO referral_logs (referrer_id, from_user_id, amount, type) VALUES ($1,$2,$3,$4)",
        [referrerId, telegramId, bonus, "ad_bonus"]
      );
    }

    res.json({ success: true });

  } catch (error) {
    console.log("Reward Ad Error:", error);
    res.status(500).json({ error: "Server error" });
  }
});





// ===== SPIN SYSTEM =====
app.post("/spin", verifyTelegramUser, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id.toString();

    // User check
    const userResult = await pool.query(
      "SELECT balance, last_spin_at FROM users WHERE telegram_id=$1",
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "User not found" });
    }

    const user = userResult.rows[0];

    // 24 hour check
    if (user.last_spin_at) {
      const lastSpin = new Date(user.last_spin_at);
      const now = new Date();

      const diffHours = (now - lastSpin) / (1000 * 60 * 60);

      if (diffHours < 24) {
        return res.status(400).json({
          success: false,
          message: "You already spun in last 24 hours"
        });
      }
    }

    // Random reward
    const rewards = [50, 75, 100, 150, 200, 500];
    const randomIndex = Math.floor(Math.random() * rewards.length);
    const reward = rewards[randomIndex];

    const newBalance = Number(user.balance) + reward;

    await pool.query(
      "UPDATE users SET balance=$1, last_spin_at=NOW() WHERE telegram_id=$2",
      [newBalance, telegramId]
    );

    res.json({
      success: true,
      reward: reward,
      balance: newBalance
    });

  } catch (error) {
    console.log("Spin error:", error);
    res.status(500).json({ error: "Server error" });
  }
});




// ===== DAILY BONUS SYSTEM =====
app.post("/daily", verifyTelegramUser, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id.toString();
    const DAILY_REWARD = 100; // তুমি চাইলে change করতে পারো

    const userResult = await pool.query(
      "SELECT balance, last_daily_at FROM users WHERE telegram_id=$1",
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "User not found" });
    }

    const user = userResult.rows[0];

    // 24 hour check
    if (user.last_daily_at) {
      const lastDaily = new Date(user.last_daily_at);
      const now = new Date();

      const diffHours = (now - lastDaily) / (1000 * 60 * 60);

      if (diffHours < 24) {
        return res.status(400).json({
          success: false,
          message: "Daily already claimed"
        });
      }
    }

    const newBalance = Number(user.balance) + DAILY_REWARD;

    await pool.query(
      "UPDATE users SET balance=$1, last_daily_at=NOW() WHERE telegram_id=$2",
      [newBalance, telegramId]
    );

    res.json({
      success: true,
      reward: DAILY_REWARD,
      balance: newBalance
    });

  } catch (error) {
    console.log("Daily error:", error);
    res.status(500).json({ error: "Server error" });
  }
});



// ===== SHORTLINK SYSTEM =====
app.post("/shortlink", verifyTelegramUser, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id.toString();
    const { link_id } = req.body;

    if (!link_id) {
      return res.status(400).json({ error: "Link ID required" });
    }

    const SHORTLINK_REWARD = 50; // তুমি চাইলে change করতে পারো

    // Check already claimed
    const existing = await pool.query(
      "SELECT id FROM shortlink_logs WHERE telegram_id=$1 AND link_id=$2",
      [telegramId, link_id]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Already claimed this link"
      });
    }

    // Get current balance
    const userResult = await pool.query(
      "SELECT balance FROM users WHERE telegram_id=$1",
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "User not found" });
    }

    const currentBalance = Number(userResult.rows[0].balance);
    const newBalance = currentBalance + SHORTLINK_REWARD;

    // Update balance
    await pool.query(
      "UPDATE users SET balance=$1 WHERE telegram_id=$2",
      [newBalance, telegramId]
    );

    // Log reward
    await pool.query(
      "INSERT INTO shortlink_logs (telegram_id, link_id, reward) VALUES ($1,$2,$3)",
      [telegramId, link_id, SHORTLINK_REWARD]
    );

    res.json({
      success: true,
      reward: SHORTLINK_REWARD,
      balance: newBalance
    });

  } catch (error) {
    console.log("Shortlink error:", error);
    res.status(500).json({ error: "Server error" });
  }
});






// ===== WITHDRAW SYSTEM =====
app.post("/withdraw", verifyTelegramUser, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id.toString();
    const { amount, method, account_number } = req.body;

    const MIN_WITHDRAW = 1000;

    if (!amount || !method || !account_number) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (amount < MIN_WITHDRAW) {
      return res.status(400).json({
        success: false,
        message: "Minimum withdraw is 1000 coins"
      });
    }

    // Get current balance
    const userResult = await pool.query(
      "SELECT balance FROM users WHERE telegram_id=$1",
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "User not found" });
    }

    const currentBalance = Number(userResult.rows[0].balance);

    if (currentBalance < amount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient balance"
      });
    }

    const newBalance = currentBalance - amount;

    if (newBalance < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid balance calculation"
      });
    }

    // Deduct balance
    await pool.query(
      "UPDATE users SET balance=$1 WHERE telegram_id=$2",
      [newBalance, telegramId]
    );

    // Insert withdraw request
    await pool.query(
      `INSERT INTO withdraw_requests 
       (user_id, amount, method, account_number, status) 
       VALUES ($1,$2,$3,$4,'pending')`,
      [telegramId, amount, method, account_number]
    );

    res.json({
      success: true,
      message: "Withdraw request submitted"
    });

  } catch (error) {
    console.log("Withdraw error:", error);
    res.status(500).json({ error: "Server error" });
  }
});










// ================= START SERVER =================
bot.launch();
app.listen(5000, () => {
  console.log("✅ API running on port 5000");
});




