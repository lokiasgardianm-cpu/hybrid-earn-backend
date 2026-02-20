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
        `INSERT INTO users 
   (telegram_id, username, coin_balance, cash_balance, referrals, referred_by)
   VALUES ($1, $2, $3, 0, 0, $4)`,
        [
          telegramId,
          username,
          200,
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

          await updateCoinWithLedger(
            refId,
            1000,
            "referral",
            "join_bonus"
          );

          await pool.query(
            "UPDATE users SET referrals = referrals + 1 WHERE telegram_id=$1",
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



async function verifyAdmin(req, res, next) {
  try {
    const telegramId = req.telegramUser.id.toString();

    const result = await pool.query(
      "SELECT * FROM admin_users WHERE telegram_id=$1",
      [telegramId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Admin access required"
      });
    }

    req.admin = result.rows[0];
    next();

  } catch (error) {
    console.log("Admin verify error:", error);
    res.status(500).json({ error: "Server error" });
  }
}







// ===== TAP ANTI-CHEAT MEMORY STORE =====
const tapTracker = new Map();


// ===== REUSABLE LEDGER FUNCTION =====
async function updateCoinWithLedger(
  userId,
  amount,
  type,
  source,
  externalClient = null
) {
  const client = externalClient || await pool.connect();
  const shouldRelease = !externalClient;

  try {
    if (!externalClient) await client.query("BEGIN");

    const result = await client.query(
      "SELECT coin_balance FROM users WHERE telegram_id=$1 FOR UPDATE",
      [userId]
    );

    if (result.rows.length === 0) throw new Error("User not found");

    const current = Number(result.rows[0].coin_balance);
    const newBalance = current + amount;

    if (newBalance < 0) throw new Error("Insufficient coin balance");

    await client.query(
      "UPDATE users SET coin_balance=$1 WHERE telegram_id=$2",
      [newBalance, userId]
    );

    await client.query(
      `INSERT INTO ledger (user_id, amount, type, source)
       VALUES ($1,$2,$3,$4)`,
      [userId, amount, type, source]
    );

    if (!externalClient) await client.query("COMMIT");

    return newBalance;

  } catch (err) {
    if (!externalClient) await client.query("ROLLBACK");
    throw err;
  } finally {
    if (shouldRelease) client.release();
  }
}


async function updateCashWithLedger(
  userId,
  amount,
  type,
  source,
  externalClient = null
) {
  const client = externalClient || await pool.connect();
  const shouldRelease = !externalClient;

  try {
    if (!externalClient) await client.query("BEGIN");

    const result = await client.query(
      "SELECT cash_balance FROM users WHERE telegram_id=$1 FOR UPDATE",
      [userId]
    );

    if (result.rows.length === 0) throw new Error("User not found");

    const current = Number(result.rows[0].cash_balance);
    const newBalance = current + amount;

    if (newBalance < 0) throw new Error("Insufficient cash balance");

    await client.query(
      "UPDATE users SET cash_balance=$1 WHERE telegram_id=$2",
      [newBalance, userId]
    );

    await client.query(
      `INSERT INTO ledger (user_id, amount, type, source)
       VALUES ($1,$2,$3,$4)`,
      [userId, amount, type, source]
    );

    if (!externalClient) await client.query("COMMIT");

    return newBalance;

  } catch (err) {
    if (!externalClient) await client.query("ROLLBACK");
    throw err;
  } finally {
    if (shouldRelease) client.release();
  }
}




// ================= API ROUTES =================


// ===== TAP ROUTE (CLEAN PG VERSION) =====

// ===== SECURE TAP ROUTE =====


app.post("/tap", verifyTelegramUser, async (req, res) => {
  const client = await pool.connect();

  try {
    const telegramId = req.telegramUser.id.toString();

    await client.query("BEGIN");

    // 🔒 Lock user row
    const userResult = await client.query(
      `SELECT daily_tap_count, last_active_date 
       FROM users 
       WHERE telegram_id=$1 
       FOR UPDATE`,
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false });
    }

    let { daily_tap_count, last_active_date } = userResult.rows[0];

    const today = new Date().toISOString().slice(0, 10);

    // 🔁 Reset if new day
    if (!last_active_date || last_active_date.toISOString().slice(0, 10) !== today) {
      daily_tap_count = 0;

      await client.query(
        `UPDATE users 
         SET daily_tap_count=0, last_active_date=$1 
         WHERE telegram_id=$2`,
        [today, telegramId]
      );
    }

    // 🚫 Daily limit check (MAX 480)
    if (daily_tap_count >= 480) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Daily tap limit reached"
      });
    }

    // 🎁 Tap reward (economy controlled later)
    const rewardPerTap = 5;

    await updateCoinWithLedger(
      telegramId,
      rewardPerTap,
      "tap_reward",
      "tap",
      client
    );

    // ➕ Increase tap count
    await client.query(
      `UPDATE users 
       SET daily_tap_count = daily_tap_count + 1 
       WHERE telegram_id=$1`,
      [telegramId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      reward: rewardPerTap
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.log("Tap error:", error);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
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
      "SELECT telegram_id, coin_balance, cash_balance, referrals, referral_earnings FROM users WHERE telegram_id=$1",
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
      "SELECT telegram_id, username, coin_balance FROM users WHERE referred_by=$1",
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
  const client = await pool.connect();

  try {
    const telegramId = req.telegramUser.id.toString();

    await client.query("BEGIN");

    // 🔒 Lock user row
    const userResult = await client.query(
      `SELECT daily_ad_count, last_active_date 
       FROM users 
       WHERE telegram_id=$1 
       FOR UPDATE`,
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false });
    }

    let { daily_ad_count, last_active_date } = userResult.rows[0];

    const today = new Date().toISOString().slice(0, 10);

    // 🔁 Reset if new day
    if (!last_active_date || last_active_date.toISOString().slice(0, 10) !== today) {
      daily_ad_count = 0;

      await client.query(
        `UPDATE users 
         SET daily_ad_count=0, last_active_date=$1 
         WHERE telegram_id=$2`,
        [today, telegramId]
      );
    }

    // 🚫 Daily limit check
    if (daily_ad_count >= 100) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Daily ad limit reached"
      });
    }

    // 🎁 Get reward from config
    const rewardResult = await client.query(
      "SELECT value FROM economy_config WHERE key='ad_reward'"
    );

    const rewardAmount = Number(rewardResult.rows[0].value);

    // 💰 Add coin via ledger
    await updateCoinWithLedger(
      telegramId,
      rewardAmount,
      "reward_ad",
      "Ad reward",
      client
    );

    // ➕ Increase count
    await client.query(
      `UPDATE users 
       SET daily_ad_count = daily_ad_count + 1 
       WHERE telegram_id=$1`,
      [telegramId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      reward: rewardAmount
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.log("Ad error:", error);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});





// ===== SPIN SYSTEM =====
app.post("/spin", verifyTelegramUser, async (req, res) => {
  const client = await pool.connect();

  try {
    const telegramId = req.telegramUser.id.toString();

    await client.query("BEGIN");

    // 🔒 Lock user row
    const userResult = await client.query(
      `SELECT daily_spin_count, last_active_date 
       FROM users 
       WHERE telegram_id=$1 
       FOR UPDATE`,
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false });
    }

    let { daily_spin_count, last_active_date } = userResult.rows[0];

    const today = new Date().toISOString().slice(0, 10);

    // 🔁 Reset if new day
    if (!last_active_date || last_active_date.toISOString().slice(0, 10) !== today) {
      daily_spin_count = 0;

      await client.query(
        `UPDATE users 
         SET daily_spin_count=0, last_active_date=$1 
         WHERE telegram_id=$2`,
        [today, telegramId]
      );
    }

    // 🚫 Daily limit check (MAX 3)
    if (daily_spin_count >= 3) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Daily spin limit reached"
      });
    }

    // 🎁 Spin reward logic (random example)
    const rewardAmount = Math.floor(Math.random() * 50) + 10;

    // 💰 Add coin via ledger
    await updateCoinWithLedger(
      telegramId,
      rewardAmount,
      "spin_reward",
      "spin",
      client
    );

    // ➕ Increase count
    await client.query(
      `UPDATE users 
       SET daily_spin_count = daily_spin_count + 1 
       WHERE telegram_id=$1`,
      [telegramId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      reward: rewardAmount
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.log("Spin error:", error);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});



// ===== DAILY BONUS SYSTEM =====
app.post("/daily", verifyTelegramUser, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id.toString();
    const DAILY_REWARD = 100; // তুমি চাইলে change করতে পারো

    const userResult = await pool.query(
      "SELECT coin_balance, last_daily_at FROM users WHERE telegram_id=$1",
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

    const newBalance = await updateCoinWithLedger(
      telegramId,
      DAILY_REWARD,
      "daily",
      "/daily"
    );

    await pool.query(
      "UPDATE users SET last_daily_at=NOW() WHERE telegram_id=$1",
      [telegramId]
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
  const client = await pool.connect();

  try {
    const telegramId = req.telegramUser.id.toString();

    await client.query("BEGIN");

    // 🔒 Lock user row
    const userResult = await client.query(
      `SELECT daily_shortlink_count, last_active_date 
       FROM users 
       WHERE telegram_id=$1 
       FOR UPDATE`,
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false });
    }

    let { daily_shortlink_count, last_active_date } = userResult.rows[0];

    const today = new Date().toISOString().slice(0, 10);

    // 🔁 Reset if new day
    if (!last_active_date || last_active_date.toISOString().slice(0, 10) !== today) {
      daily_shortlink_count = 0;

      await client.query(
        `UPDATE users 
         SET daily_shortlink_count=0, last_active_date=$1 
         WHERE telegram_id=$2`,
        [today, telegramId]
      );
    }

    // 🚫 Daily limit check (MAX 10)
    if (daily_shortlink_count >= 10) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Daily shortlink limit reached"
      });
    }

    // 🎁 Get reward from config
    const rewardResult = await client.query(
      "SELECT value FROM economy_config WHERE key='shortlink_reward'"
    );

    const rewardAmount = Number(rewardResult.rows[0].value);

    // 💰 Add coin via ledger
    await updateCoinWithLedger(
      telegramId,
      rewardAmount,
      "shortlink_reward",
      "shortlink",
      client
    );

    // ➕ Increase count
    await client.query(
      `UPDATE users 
       SET daily_shortlink_count = daily_shortlink_count + 1 
       WHERE telegram_id=$1`,
      [telegramId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      reward: rewardAmount
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.log("Shortlink error:", error);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});






// ===== WITHDRAW SYSTEM =====
// ===== CASH WITHDRAW SYSTEM (ATOMIC) =====
app.post("/withdraw", verifyTelegramUser, async (req, res) => {
  const client = await pool.connect();

  try {
    const telegramId = req.telegramUser.id.toString();
    const { cash_amount, method, account_number } = req.body;

    if (!cash_amount || !method || !account_number) {
      return res.status(400).json({
        success: false,
        message: "Missing fields"
      });
    }

    await client.query("BEGIN");

    // Get minimum withdraw
    const minResult = await client.query(
      "SELECT value FROM economy_config WHERE key='min_withdraw_cash'"
    );

    const minWithdraw = Number(minResult.rows[0].value);

    if (cash_amount < minWithdraw) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: `Minimum withdraw is ${minWithdraw} cash`
      });
    }

    // Lock user row
    const userResult = await client.query(
      "SELECT cash_balance FROM users WHERE telegram_id=$1 FOR UPDATE",
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "User not found"
      });
    }

    const currentCash = Number(userResult.rows[0].cash_balance);

    if (currentCash < cash_amount) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Insufficient cash balance"
      });
    }

    // Deduct cash
    await client.query(
      "UPDATE users SET cash_balance=$1 WHERE telegram_id=$2",
      [currentCash - cash_amount, telegramId]
    );

    // Ledger entry
    await client.query(
      `INSERT INTO ledger (user_id, amount, type, source)
       VALUES ($1,$2,$3,$4)`,
      [telegramId, -cash_amount, "withdraw", "cash_withdraw"]
    );

    // Insert withdraw request
    await client.query(
      `INSERT INTO withdraw_requests
       (user_id, amount, method, account_number, status)
       VALUES ($1,$2,$3,$4,'pending')`,
      [telegramId, cash_amount, method, account_number]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Withdraw request submitted"
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.log("Withdraw error:", error);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});



// ===== ADMIN APPROVE WITHDRAW =====
app.post(
  "/admin/withdraw/approve",
  verifyTelegramUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const { request_id } = req.body;

      if (!request_id) {
        return res.status(400).json({
          success: false,
          message: "Request ID required"
        });
      }

      const requestResult = await pool.query(
        "SELECT * FROM withdraw_requests WHERE id=$1 AND status='pending'",
        [request_id]
      );

      if (requestResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid or already processed request"
        });
      }

      await pool.query(
        "UPDATE withdraw_requests SET status='approved' WHERE id=$1",
        [request_id]
      );

      res.json({
        success: true,
        message: "Withdraw approved successfully"
      });

    } catch (error) {
      console.log("Approve error:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);






// ===== ADMIN REJECT WITHDRAW (ATOMIC VERSION) =====
app.post(
  "/admin/withdraw/reject",
  verifyTelegramUser,
  verifyAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const { request_id } = req.body;

      if (!request_id) {
        return res.status(400).json({
          success: false,
          message: "Request ID required"
        });
      }

      await client.query("BEGIN");

      const requestResult = await client.query(
        "SELECT * FROM withdraw_requests WHERE id=$1 AND status='pending' FOR UPDATE",
        [request_id]
      );

      if (requestResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Invalid or already processed request"
        });
      }

      const withdrawData = requestResult.rows[0];

      // 🔁 Refund via Ledger (same transaction)
      await updateCashWithLedger(
        withdrawData.user_id,
        withdrawData.amount,
        "admin_adjust",
        "withdraw_reject_refund",
        client
      );

      await client.query(
        "UPDATE withdraw_requests SET status='rejected' WHERE id=$1",
        [request_id]
      );

      await client.query("COMMIT");

      res.json({
        success: true,
        message: "Withdraw rejected & refunded successfully"
      });

    } catch (error) {
      await client.query("ROLLBACK");
      console.log("Reject error:", error);
      res.status(500).json({ error: "Server error" });
    } finally {
      client.release();
    }
  }
);





// ===== CONVERT COIN → CASH =====
app.post("/convert", verifyTelegramUser, async (req, res) => {
  const client = await pool.connect();

  try {
    const telegramId = req.telegramUser.id.toString();
    const { cash_amount } = req.body;

    if (!cash_amount || cash_amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid cash amount"
      });
    }

    await client.query("BEGIN");

    // Get conversion rate
    const rateResult = await client.query(
      "SELECT value FROM economy_config WHERE key='coin_to_cash_rate'"
    );

    const rate = Number(rateResult.rows[0].value);
    const requiredCoin = cash_amount * rate;

    // Lock user row
    const userResult = await client.query(
      "SELECT coin_balance, cash_balance FROM users WHERE telegram_id=$1 FOR UPDATE",
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "User not found" });
    }

    const currentCoin = Number(userResult.rows[0].coin_balance);
    const currentCash = Number(userResult.rows[0].cash_balance);

    if (currentCoin < requiredCoin) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Not enough coins"
      });
    }

    // Deduct coin
    await client.query(
      "UPDATE users SET coin_balance=$1 WHERE telegram_id=$2",
      [currentCoin - requiredCoin, telegramId]
    );

    // Add cash
    await client.query(
      "UPDATE users SET cash_balance=$1 WHERE telegram_id=$2",
      [currentCash + cash_amount, telegramId]
    );

    // Insert ledger entry (conversion)
    await client.query(
      `INSERT INTO ledger 
       (user_id, amount, type, source) 
       VALUES ($1,$2,$3,$4)`,
      [telegramId, -requiredCoin, "conversion", "coin_to_cash"]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Conversion successful",
      converted_cash: cash_amount,
      used_coin: requiredCoin
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.log("Convert error:", error);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});









// ================= START SERVER =================
bot.launch();
app.listen(5000, () => {
  console.log("✅ API running on port 5000");
});




