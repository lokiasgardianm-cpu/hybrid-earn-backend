require("dotenv").config();
const express = require("express");
const path = require('path');
const { Telegraf } = require("telegraf");
const { Pool } = require("pg");
const cors = require("cors");
const crypto = require("crypto");






console.log("🚀 Server Starting...");

const app = express();

app.use(cors({
  origin: "*",
}));

app.use(express.json());

// Serve frontend from public folder
app.use(express.static(path.join(__dirname, "public")));

// Root route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});




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
          1000,
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

          const bonusResult = await pool.query(
            "SELECT value FROM economy_config WHERE key='referral_join_bonus'"
          );

          if (bonusResult.rows.length === 0) {
            throw new Error("referral_join_bonus not set in economy_config");
          }

          const joinBonus = Number(bonusResult.rows[0].value);

          await updateCoinWithLedger(
            refId,
            joinBonus,
            "referral",
            "join_bonus"
          );

          await pool.query(
            "UPDATE users SET referrals = referrals + 1 WHERE telegram_id=$1",
            [refId]
          );

          await pool.query(
            "INSERT INTO referral_logs (referrer_id, from_user_id, amount, type) VALUES ($1,$2,$3,$4)",
            [refId, telegramId, joinBonus, "join_bonus"]
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
  const crypto = require("crypto");

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
    .update(process.env.BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return calculatedHash === hash;
}



function verifyTelegramUser(req, res, next) {

  const initData =
    req.headers["x-telegram-init-data"] ||
    req.body?.initData;

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

    // ===== LIFETIME 1% REFERRAL BONUS =====
    if (
      amount > 0 &&
      ["tap_reward", "reward_ad", "spin_reward", "shortlink_reward", "daily"].includes(type)
    ) {

      const refResult = await client.query(
        "SELECT referred_by FROM users WHERE telegram_id=$1",
        [userId]
      );

      const referrerId = refResult.rows[0]?.referred_by;

      if (referrerId) {

        const percentResult = await client.query(
          "SELECT value FROM economy_config WHERE key='referral_percent'"
        );

        if (percentResult.rows.length === 0) {
          throw new Error("referral_percent not set");
        }


        const percent = Number(percentResult.rows[0].value);

        const referralBonus = Math.floor(amount * (percent / 100));

        if (referralBonus > 0) {

          const refUser = await client.query(
            "SELECT coin_balance FROM users WHERE telegram_id=$1 FOR UPDATE",
            [referrerId]
          );

          if (refUser.rows.length > 0) {

            const refCurrent = Number(refUser.rows[0].coin_balance);

            await client.query(
              "UPDATE users SET coin_balance=$1 WHERE telegram_id=$2",
              [refCurrent + referralBonus, referrerId]
            );

            await client.query(
              `INSERT INTO ledger (user_id, amount, type, source)
           VALUES ($1,$2,$3,$4)`,
              [referrerId, referralBonus, "referral_bonus", "1_percent_lifetime"]
            );

            await client.query(
              "UPDATE users SET referral_earnings = referral_earnings + $1 WHERE telegram_id=$2",
              [referralBonus, referrerId]
            );
          }
        }
      }
    }

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


app.post("/user", verifyTelegramUser, async (req, res) => {

  const client = await pool.connect();

  try {

    const telegramId = req.telegramUser.id.toString();

    const result = await client.query(
      "SELECT coin_balance, cash_balance, daily_tap_count FROM users WHERE telegram_id=$1",
      [telegramId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false });
    }

    res.json({
      success: true,
      coin_balance: result.rows[0].coin_balance,
      cash_balance: result.rows[0].cash_balance,
      daily_tap_count: result.rows[0].daily_tap_count
    });

  } catch (err) {
    console.log("User route error:", err);
    res.status(500).json({ success: false });
  } finally {
    client.release();
  }

});





// ===== TAP ROUTE (CLEAN PG VERSION) =====

// ===== SECURE TAP ROUTE =====


app.post("/tap", verifyTelegramUser, async (req, res) => {
  const client = await pool.connect();

  try {
    const telegramId = req.telegramUser.id.toString();

    await client.query("BEGIN");

    // 🔒 Lock user row
    const userResult = await client.query(
      `SELECT daily_tap_count, last_tap_date 
       FROM users 
       WHERE telegram_id=$1 
       FOR UPDATE`,
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false });
    }

    let { daily_tap_count, last_tap_date } = userResult.rows[0];

    const today = new Date().toISOString().slice(0, 10);

    // 🔁 Reset if new day
    if (
      !last_tap_date ||
      new Date(last_tap_date).toISOString().slice(0, 10) !== today
    ) {
      daily_tap_count = 0;

      await client.query(
        `UPDATE users 
         SET daily_tap_count=0, last_tap_date=$1 
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
    const rewardResult = await client.query(
      "SELECT value FROM economy_config WHERE key='tap_reward'"
    );

    if (rewardResult.rows.length === 0) {
      throw new Error("tap_reward not set in economy_config");
    }

    const rewardPerTap = Number(rewardResult.rows[0].value);

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

    // Get updated balance
    const balanceResult = await client.query(
      "SELECT coin_balance FROM users WHERE telegram_id=$1",
      [telegramId]
    );

    res.json({
      success: true,
      reward: rewardPerTap,
      coin_balance: balanceResult.rows[0].coin_balance
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
      `SELECT daily_ad_count, last_ad_date 
       FROM users 
       WHERE telegram_id=$1 
       FOR UPDATE`,
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false });
    }

    let { daily_ad_count, last_ad_date } = userResult.rows[0];

    const today = new Date().toISOString().slice(0, 10);

    // 🔁 Reset if new day
    if (
      !last_ad_date ||
      new Date(last_ad_date).toISOString().slice(0, 10) !== today
    ) {
      daily_ad_count = 0;

      await client.query(
        `UPDATE users 
         SET daily_ad_count=0, last_ad_date=$1 
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

    if (rewardResult.rows.length === 0) {
      throw new Error("ad_reward not set in economy_config");
    }

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
      `SELECT daily_spin_count, last_spin_date 
       FROM users 
       WHERE telegram_id=$1 
       FOR UPDATE`,
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false });
    }

    let { daily_spin_count, last_spin_date } = userResult.rows[0];

    const today = new Date().toISOString().slice(0, 10);

    // 🔁 Reset if new day
    if (
      !last_spin_date ||
      new Date(last_spin_date).toISOString().slice(0, 10) !== today
    ) {
      daily_spin_count = 0;

      await client.query(
        `UPDATE users 
         SET daily_spin_count=0, last_spin_date=$1 
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
    const minResult = await client.query(
      "SELECT value FROM economy_config WHERE key='spin_min_reward'"
    );

    if (minResult.rows.length === 0) {
      throw new Error("spin_min_reward not set");
    }

    const maxResult = await client.query(
      "SELECT value FROM economy_config WHERE key='spin_max_reward'"
    );

    if (maxResult.rows.length === 0) {
      throw new Error("spin_max_reward not set");
    }

    const minReward = Number(minResult.rows[0].value);
    const maxReward = Number(maxResult.rows[0].value);

    const rewardAmount =
      Math.floor(Math.random() * (maxReward - minReward + 1)) + minReward;

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



app.post("/daily", verifyTelegramUser, async (req, res) => {
  const client = await pool.connect();

  try {
    const telegramId = req.telegramUser.id.toString();

    await client.query("BEGIN");

    const rewardResult = await client.query(
      "SELECT value FROM economy_config WHERE key='daily_reward'"
    );

    if (rewardResult.rows.length === 0) {
      throw new Error("daily_reward not set");
    }

    const DAILY_REWARD = Number(rewardResult.rows[0].value);

    const userResult = await client.query(
      "SELECT last_daily_at FROM users WHERE telegram_id=$1 FOR UPDATE",
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "User not found" });
    }

    const user = userResult.rows[0];

    if (user.last_daily_at) {
      const lastDaily = new Date(user.last_daily_at);
      const now = new Date();
      const diffHours = (now - lastDaily) / (1000 * 60 * 60);

      if (diffHours < 24) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Daily already claimed"
        });
      }
    }

    await updateCoinWithLedger(
      telegramId,
      DAILY_REWARD,
      "daily",
      "/daily",
      client
    );

    await client.query(
      "UPDATE users SET last_daily_at=NOW() WHERE telegram_id=$1",
      [telegramId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      reward: DAILY_REWARD
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.log("Daily error:", error);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
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
      `SELECT daily_shortlink_count, last_shortlink_date 
       FROM users 
       WHERE telegram_id=$1 
       FOR UPDATE`,
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false });
    }

    let { daily_shortlink_count, last_shortlink_date } = userResult.rows[0];

    const today = new Date().toISOString().slice(0, 10);

    // 🔁 Reset if new day
    if (
      !last_shortlink_date ||
      new Date(last_shortlink_date).toISOString().slice(0, 10) !== today
    ) {
      daily_shortlink_count = 0;

      await client.query(
        `UPDATE users 
         SET daily_shortlink_count=0, last_shortlink_date=$1 
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

    if (rewardResult.rows.length === 0) {
      throw new Error("shortlink_reward not set");
    }

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
    const cash_amount = Number(req.body.cash_amount);
    const { method, account_number } = req.body;

    if (isNaN(cash_amount) || cash_amount <= 0 || !method || !account_number) {

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

    if (minResult.rows.length === 0) {
      throw new Error("min_withdraw_cash not set");
    }

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
    await updateCashWithLedger(
      telegramId,
      -cash_amount,
      "withdraw",
      "cash_withdraw",
      client
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

      await client.query(
        "UPDATE withdraw_requests SET status='approved' WHERE id=$1",
        [request_id]
      );

      await client.query("COMMIT");

      res.json({
        success: true,
        message: "Withdraw approved successfully"
      });

    } catch (error) {
      await client.query("ROLLBACK");
      console.log("Approve error:", error);
      res.status(500).json({ error: "Server error" });
    } finally {
      client.release();
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





// ===== ADMIN UPDATE ECONOMY CONFIG =====
app.post(
  "/admin/update-config",
  verifyTelegramUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const { key, value } = req.body;

      if (!key || value === undefined) {
        return res.status(400).json({ success: false });
      }

      const updateResult = await pool.query(
        "UPDATE economy_config SET value=$1 WHERE key=$2 RETURNING *",
        [value, key]
      );

      if (updateResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid config key"
        });
      }
      res.json({ success: true });

    } catch (err) {
      res.status(500).json({ error: "Server error" });
    }
  });



// ===== CONVERT COIN → CASH =====
app.post("/convert", verifyTelegramUser, async (req, res) => {
  const client = await pool.connect();

  try {
    const telegramId = req.telegramUser.id.toString();
    const cash_amount = Number(req.body.cash_amount);

    if (isNaN(cash_amount) || cash_amount <= 0) {
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

    if (rateResult.rows.length === 0) {
      throw new Error("coin_to_cash_rate not set");
    }

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

    if (currentCoin < requiredCoin) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Not enough coins"
      });
    }

    await updateCoinWithLedger(
      telegramId,
      -requiredCoin,
      "conversion",
      "coin_to_cash",
      client
    );

    await updateCashWithLedger(
      telegramId,
      cash_amount,
      "conversion",
      "coin_to_cash",
      client
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




process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));








// ================= START SERVER =================
app.post(`/bot${process.env.BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body);
  res.sendStatus(200);
});


if (process.env.RENDER) {
  console.log("Running on Render with webhook");
} else {
  bot.launch();
}
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT}`);
});




