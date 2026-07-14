require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const mongoose = require("mongoose");
const TelegramBot = require("node-telegram-bot-api");

const User = require("./models/User");
const Transaction = require("./models/Transaction");
const GameBet = require("./models/GameBet");
const Offer = require("./models/Offer");
const Tournament = require("./models/Tournament");

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
// Capture raw body for IPN signature verification
app.use(express.json({
  limit: "10mb",
  verify: (req, res, buf) => {
    if (req.url === '/api/crypto/ipn') {
      req.rawBody = buf.toString('utf8');
    }
  }
}));

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// Telegram Bot (polling mode for dev, webhook for production)
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// ============================================
// HELPER: Get or create user
// ============================================
async function getOrCreateUser(telegramUserId) {
  // Convert to number; use 0 as fallback for "demo" or invalid values
  const numericId = Number(telegramUserId);
  if (!numericId || isNaN(numericId)) {
    // Return a default demo user object without DB
    return { telegramId: 0, dollarBalance: 0, starBalance: 0, save: async () => {} };
  }
  let user = await User.findOne({ telegramId: numericId });
  if (!user) {
    user = await User.create({
      telegramId: numericId,
      dollarBalance: 0,
      starBalance: 0,
    });
  }
  return user;
}

// Credit pending referral reward to referrer when this user makes their first deposit.
// Idempotent: only fires once via the referralRewarded flag.
async function creditReferralOnDeposit(depositorTelegramId) {
  try {
    const numericId = Number(depositorTelegramId);
    if (!numericId) return;
    const depositor = await User.findOne({ telegramId: numericId });
    if (!depositor) return;
    if (!depositor.referredBy || depositor.referralRewarded) return;

    const referrer = await User.findOne({ telegramId: depositor.referredBy });
    if (!referrer) return;

    const reward = 5;
    referrer.starBalance = (referrer.starBalance || 0) + reward;
    await referrer.save();

    depositor.referralRewarded = true;
    await depositor.save();

    await Transaction.create({
      telegramId: referrer.telegramId,
      type: "referral",
      currency: "star",
      amount: reward,
      status: "completed",
      description: `Referral reward: ${reward} ⭐ (referred user ${numericId} made first deposit)`,
    });

    try {
      await bot.sendMessage(referrer.telegramId,
        `🎉 *Referral Reward Unlocked!*\n\n` +
        `👤 Your referred friend just made their first deposit.\n` +
        `💰 You earned ${reward} ⭐!`,
        { parse_mode: "Markdown" }
      );
    } catch (e) { /* ignore */ }
  } catch (err) {
    console.error("creditReferralOnDeposit error:", err.message);
  }
}

// ============================================
// POST /api/deposit
// Creates a Telegram Stars invoice for deposit
// ============================================
app.post("/api/deposit", async (req, res) => {
  try {
    const { userId, currency, amount } = req.body;

    if (!userId || !currency || !amount) {
      return res.status(400).json({ error: "Missing userId, currency, or amount" });
    }

    if (currency === "star") {
      // Telegram Stars payment via invoice
      const invoice = await bot.createInvoiceLink(
        `Deposit ${amount} Stars`,           // title
        `Add ${amount} Stars to your wallet`, // description
        JSON.stringify({ action: "deposit", currency: "star", userId, amount }), // payload
        "",                                   // provider_token (empty for Stars)
        "XTR",                                // currency
        [{ label: `${amount} Stars`, amount: amount }] // prices
      );

      return res.json({ invoiceUrl: invoice });
    }

    if (currency === "dollar") {
      // For dollar deposits, you need a real payment provider (Stripe, etc.)
      // Configure provider_token from BotFather -> Payments
      const PAYMENT_PROVIDER_TOKEN = process.env.PAYMENT_PROVIDER_TOKEN || "";

      if (!PAYMENT_PROVIDER_TOKEN) {
        return res.status(500).json({ error: "Payment provider not configured for dollar deposits" });
      }

      const invoice = await bot.createInvoiceLink({
        title: `Deposit $${amount}`,
        description: `Add $${amount} to your wallet`,
        payload: JSON.stringify({ action: "deposit", currency: "dollar", userId, amount }),
        provider_token: PAYMENT_PROVIDER_TOKEN,
        currency: "USD",
        prices: [{ label: `$${amount}`, amount: amount * 100 }], // cents
      });

      return res.json({ invoiceUrl: invoice });
    }

    return res.status(400).json({ error: "Invalid currency. Use 'dollar' or 'star'" });
  } catch (error) {
    console.error("Deposit error:", error?.response?.body || error.message || error);
    const msg = error?.response?.body?.description || error.message || "Failed to create invoice";
    return res.status(500).json({ error: msg });
  }
});

// ============================================
// POST /api/withdraw
// Creates a PENDING withdrawal request (admin must approve)
// ============================================
app.post("/api/withdraw", async (req, res) => {
  try {
    const { userId, currency, amount, cryptoAddress, network } = req.body;

    if (!userId || !currency || !amount) {
      return res.status(400).json({ error: "Missing userId, currency, or amount" });
    }
    if (!cryptoAddress) {
      return res.status(400).json({ error: "Crypto wallet address is required" });
    }

    const user = await getOrCreateUser(userId);

    // Withdraw only from winning
    const winningField = currency === "dollar" ? "dollarWinning" : "starWinning";
    if ((user[winningField] || 0) < amount) {
      return res.status(400).json({ error: "Insufficient winning balance. Withdrawals are only allowed from winnings." });
    }

    // Hold the amount (deduct from winning immediately to prevent double-spend)
    user[winningField] -= amount;
    await user.save();

    // Create PENDING transaction
    await Transaction.create({
      telegramId: userId,
      type: "withdraw",
      currency,
      amount: -amount,
      status: "pending",
      cryptoAddress,
      withdrawalNetwork: network || "",
      description: `Withdrawal of ${currency === "dollar" ? "$" + amount : amount + " Stars"} to ${cryptoAddress}`,
    });

    // Send notification to admin
    try {
      const symbol = currency === "dollar" ? "$" : "⭐";
      await bot.sendMessage(6965488457,
        `🔔 *New Withdrawal Request!*\n\n` +
        `👤 User ID: \`${userId}\`\n` +
        `💰 Amount: ${symbol}${amount}\n` +
        `🔗 Network: ${network || "N/A"}\n` +
        `📍 Address: \`${cryptoAddress}\`\n\n` +
        `Open Admin Panel to approve or reject.`,
        { parse_mode: "Markdown" }
      );
    } catch (botErr) {
      console.error("Failed to send admin withdrawal notification:", botErr.message);
    }

    return res.json({
      success: true,
      message: `Withdrawal request of ${amount} ${currency} submitted. Admin will review and process it.`,
    });
  } catch (error) {
    console.error("Withdraw error:", error);
    return res.status(500).json({ error: "Withdrawal failed" });
  }
});

// ============================================
// POST /api/admin/approve-withdrawal - Admin approves withdrawal
// ============================================
app.post("/api/admin/approve-withdrawal", async (req, res) => {
  try {
    const { ownerId, transactionId } = req.body;
    if (String(ownerId) !== "6965488457") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const tx = await Transaction.findById(transactionId);
    if (!tx || tx.type !== "withdraw" || tx.status !== "pending") {
      return res.status(404).json({ error: "Pending withdrawal not found" });
    }

    tx.status = "completed";
    await tx.save();

    // Send Telegram notification to user
    try {
      const amount = Math.abs(tx.amount);
      const symbol = tx.currency === "dollar" ? "$" : "⭐";
      await bot.sendMessage(tx.telegramId, 
        `✅ *Withdrawal Approved!*\n\n` +
        `💰 Amount: ${symbol}${amount}\n` +
        `📍 Address: \`${tx.cryptoAddress}\`\n` +
        `🔗 Network: ${tx.withdrawalNetwork || "N/A"}\n\n` +
        `Your funds will be sent shortly!`,
        { parse_mode: "Markdown" }
      );
    } catch (botErr) {
      console.error("Failed to send approval notification:", botErr.message);
    }

    return res.json({ success: true, message: "Withdrawal approved and user notified" });
  } catch (error) {
    console.error("Approve withdrawal error:", error);
    return res.status(500).json({ error: "Failed to approve withdrawal" });
  }
});

// ============================================
// POST /api/admin/reject-withdrawal - Admin rejects withdrawal
// ============================================
app.post("/api/admin/reject-withdrawal", async (req, res) => {
  try {
    const { ownerId, transactionId, reason } = req.body;
    if (String(ownerId) !== "6965488457") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const tx = await Transaction.findById(transactionId);
    if (!tx || tx.type !== "withdraw" || tx.status !== "pending") {
      return res.status(404).json({ error: "Pending withdrawal not found" });
    }

    // Refund amount back to user's winning
    const user = await User.findOne({ telegramId: tx.telegramId });
    if (user) {
      const winningField = tx.currency === "dollar" ? "dollarWinning" : "starWinning";
      user[winningField] = (user[winningField] || 0) + Math.abs(tx.amount);
      await user.save();
    }

    tx.status = "failed";
    tx.description = `${tx.description} | Rejected: ${reason || "No reason"}`;
    await tx.save();

    // Send Telegram notification to user
    try {
      const amount = Math.abs(tx.amount);
      const symbol = tx.currency === "dollar" ? "$" : "⭐";
      await bot.sendMessage(tx.telegramId,
        `❌ *Withdrawal Rejected*\n\n` +
        `💰 Amount: ${symbol}${amount}\n` +
        `📍 Address: \`${tx.cryptoAddress}\`\n` +
        `${reason ? `📝 Reason: ${reason}\n` : ""}\n` +
        `Your funds have been returned to your winning balance.`,
        { parse_mode: "Markdown" }
      );
    } catch (botErr) {
      console.error("Failed to send rejection notification:", botErr.message);
    }

    return res.json({ success: true, message: "Withdrawal rejected and funds returned" });
  } catch (error) {
    console.error("Reject withdrawal error:", error);
    return res.status(500).json({ error: "Failed to reject withdrawal" });
  }
});

// ============================================
// POST /api/balance
// Get user balance
// ============================================
app.post("/api/balance", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const user = await getOrCreateUser(userId);
    // Update lastActive timestamp
    user.lastActive = new Date();
    await user.save();
    return res.json({
      dollarBalance: user.dollarBalance,
      starBalance: user.starBalance,
      dollarWinning: user.dollarWinning || 0,
      starWinning: user.starWinning || 0,
      referralCount: user.referralCount || 0,
    });
  } catch (error) {
    console.error("Balance error:", error);
    return res.status(500).json({ error: "Failed to fetch balance" });
  }
});

// ============================================
// POST /api/transactions
// Get user transactions
// ============================================
app.post("/api/transactions", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const numericId = Number(userId);
    if (!numericId || isNaN(numericId)) {
      return res.json({ transactions: [] });
    }

    const transactions = await Transaction.find({ telegramId: numericId, status: "completed" })
      .sort({ createdAt: -1 })
      .limit(20);

    return res.json({ transactions });
  } catch (error) {
    console.error("Transactions error:", error);
    return res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// ============================================
// Serve frontend static files
// ============================================
app.use(express.static(path.join(__dirname, "../public")));

// Debug: check if frontend files exist
app.get("/api/debug", (req, res) => {
  const publicDir = path.join(__dirname, "../public");
  try {
    const exists = fs.existsSync(publicDir);
    const files = exists ? fs.readdirSync(publicDir) : [];
    const indexExists = fs.existsSync(path.join(publicDir, "index.html"));
    res.json({ publicDir, exists, files, indexExists, dirname: __dirname });
  } catch (err) {
    res.json({ error: err.message, dirname: __dirname });
  }
});

// Health check API
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "telegram-wallet-backend", version: "6.0-wallet-winning-split" });
});

// ============================================
// POST /api/admin/cleanup-wins - Remove all old win transactions
// so winnings start fresh from 0. Only owner can call this.
// ============================================
app.post("/api/admin/cleanup-wins", async (req, res) => {
  try {
    const { ownerId, userId } = req.body;
    if (String(ownerId) !== "6965488457") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const filter = { type: "win", status: "completed" };
    if (userId) filter.telegramId = Number(userId);

    const result = await Transaction.deleteMany(filter);
    return res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `Deleted ${result.deletedCount} win transactions${userId ? ` for user ${userId}` : ' for all users'}. Winnings reset to 0.`,
    });
  } catch (error) {
    console.error("Cleanup error:", error);
    return res.status(500).json({ error: "Cleanup failed" });
  }
});

// Debug: check win transactions for a user
app.post("/api/debug-winnings", async (req, res) => {
  const { userId } = req.body;
  const numericId = Number(userId);
  const winTxns = await Transaction.find({ telegramId: numericId, type: "win", status: "completed" }).lean();
  const depositTxns = await Transaction.find({ telegramId: numericId, type: "deposit", status: "completed" }).lean();
  const allTxns = await Transaction.find({ telegramId: numericId, status: "completed" }).select("type currency amount").lean();
  res.json({ winCount: winTxns.length, depositCount: depositTxns.length, wins: winTxns, allTypes: allTxns.map(t => ({ type: t.type, currency: t.currency, amount: t.amount })) });
});

// Debug: GET endpoint to easily check winnings in browser
app.get("/api/debug-winnings/:userId", async (req, res) => {
  try {
    const numericId = Number(req.params.userId);
    if (!numericId) return res.json({ error: "Invalid userId" });
    
    const allTxns = await Transaction.find({ telegramId: numericId, status: "completed" })
      .select("type currency amount createdAt description")
      .sort({ createdAt: -1 })
      .lean();
    
    const winTxns = allTxns.filter(t => t.type === "win");
    const depositTxns = allTxns.filter(t => t.type === "deposit");
    
    const starWinTotal = winTxns.filter(t => t.currency === "star").reduce((s, t) => s + t.amount, 0);
    const dollarWinTotal = winTxns.filter(t => t.currency === "dollar").reduce((s, t) => s + t.amount, 0);
    const starDepositTotal = depositTxns.filter(t => t.currency === "star").reduce((s, t) => s + t.amount, 0);
    
    res.json({
      userId: numericId,
      summary: {
        starWinnings: starWinTotal,
        dollarWinnings: dollarWinTotal,
        starDeposits: starDepositTotal,
        totalTransactions: allTxns.length,
        winCount: winTxns.length,
        depositCount: depositTxns.length,
      },
      allTransactions: allTxns.map(t => ({
        type: t.type,
        currency: t.currency,
        amount: t.amount,
        date: t.createdAt,
        description: t.description,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET /api/admin/stats - Owner stats (Stars earned, all transactions)
// Only accessible with owner telegram ID
// ============================================
app.post("/api/admin/stats", async (req, res) => {
  try {
    const { ownerId } = req.body;
    
    // Only owner can access (your Telegram ID)
    if (String(ownerId) !== "6965488457") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Total Stars deposited by all users
    const starDeposits = await Transaction.aggregate([
      { $match: { type: "deposit", currency: "star", status: "completed" } },
      { $group: { _id: null, totalStars: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    // Total Dollar deposits
    const dollarDeposits = await Transaction.aggregate([
      { $match: { type: "deposit", currency: "dollar", status: "completed" } },
      { $group: { _id: null, totalDollars: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    // Recent transactions (all users)
    const recentTransactions = await Transaction.find({ type: "deposit" })
      .sort({ createdAt: -1 })
      .limit(50);

    // Total users
    const totalUsers = await User.countDocuments();

    return res.json({
      totalStarsEarned: starDeposits[0]?.totalStars || 0,
      starDepositCount: starDeposits[0]?.count || 0,
      totalDollarsEarned: dollarDeposits[0]?.totalDollars || 0,
      dollarDepositCount: dollarDeposits[0]?.count || 0,
      totalUsers,
      recentTransactions,
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ============================================
// POST /api/admin/games-stats - Per-game win/loss totals
// ============================================
app.post("/api/admin/games-stats", async (req, res) => {
  try {
    const { ownerId } = req.body;
    if (String(ownerId) !== "6965488457") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const rows = await Transaction.aggregate([
      { $match: { type: { $in: ["bet", "win"] }, status: "completed" } },
      {
        $project: {
          type: 1,
          currency: 1,
          amount: 1,
          game: {
            $ifNull: [
              "$game",
              {
                $let: {
                  vars: { d: { $ifNull: ["$description", ""] } },
                  in: {
                    $cond: [
                      { $gt: [{ $indexOfBytes: ["$$d", ":"] }, 0] },
                      { $substrBytes: ["$$d", 0, { $indexOfBytes: ["$$d", ":"] }] },
                      "unknown",
                    ],
                  },
                },
              },
            ],
          },
        },
      },
      {
        $group: {
          _id: { game: "$game", type: "$type", currency: "$currency" },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const games = {};
    for (const r of rows) {
      const g = r._id.game || "unknown";
      if (!games[g]) games[g] = { game: g, dollarWin: 0, starWin: 0, dollarLoss: 0, starLoss: 0, winCount: 0, betCount: 0 };
      const amt = Math.abs(r.total || 0);
      if (r._id.type === "win") {
        if (r._id.currency === "dollar") games[g].dollarWin += amt;
        if (r._id.currency === "star") games[g].starWin += amt;
        games[g].winCount += r.count;
      } else if (r._id.type === "bet") {
        if (r._id.currency === "dollar") games[g].dollarLoss += amt;
        if (r._id.currency === "star") games[g].starLoss += amt;
        games[g].betCount += r.count;
      }
    }

    return res.json({ games: Object.values(games).sort((a, b) => (b.dollarLoss + b.starLoss) - (a.dollarLoss + a.starLoss)) });
  } catch (error) {
    console.error("Admin games-stats error:", error);
    return res.status(500).json({ error: "Failed to fetch games stats" });
  }
});

// ============================================
// POST /api/admin/users - Get all users list with balances
// ============================================
app.post("/api/admin/users", async (req, res) => {
  try {
    const { ownerId } = req.body;
    if (String(ownerId) !== "6965488457") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const users = await User.find({}).sort({ createdAt: -1 }).select('telegramId username firstName lastName dollarBalance starBalance dollarWinning starWinning lastActive createdAt').lean();

    // Get pending withdrawal requests (include _id for approve/reject)
    const withdrawals = await Transaction.find({ type: "withdraw", status: "pending" })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ users, withdrawals });
  } catch (error) {
    console.error("Admin users error:", error);
    return res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ============================================
// POST /api/referral - Process referral when user opens app via invite link
// ============================================
app.post("/api/referral", async (req, res) => {
  try {
    const { userId, referrerId } = req.body;

    if (!userId || !referrerId) {
      return res.status(400).json({ error: "Missing userId or referrerId" });
    }

    const numericUserId = Number(userId);
    const numericReferrerId = Number(referrerId);

    if (!numericUserId || !numericReferrerId || numericUserId === numericReferrerId) {
      return res.status(400).json({ error: "Invalid referral" });
    }

    // Get or create both users
    const user = await getOrCreateUser(numericUserId);
    const referrer = await getOrCreateUser(numericReferrerId);

    if (!referrer || referrer.telegramId === 0) {
      return res.status(400).json({ error: "Referrer not found" });
    }

    // Check if user already has a referrer
    if (user.referredBy) {
      return res.json({ success: false, message: "Already referred" });
    }

    // Set referral (reward is granted only after referred user makes a deposit)
    user.referredBy = numericReferrerId;
    await user.save();

    // Increment referrer's count
    referrer.referralCount = (referrer.referralCount || 0) + 1;
    const count = referrer.referralCount;
    await referrer.save();

    // Notify referrer (pending — reward unlocks after first deposit)
    try {
      await bot.sendMessage(numericReferrerId,
        `🎉 *New Referral!*\n\n` +
        `👤 A friend joined using your link!\n` +
        `🔒 Reward of 5 ⭐ will unlock once they make their first deposit.\n` +
        `📊 Total referrals: ${count}`,
        { parse_mode: "Markdown" }
      );
    } catch (botErr) {
      console.error("Failed to send referral notification:", botErr.message);
    }

    return res.json({ success: true, pending: true, totalReferrals: count });
  } catch (error) {
    console.error("Referral error:", error);
    return res.status(500).json({ error: "Referral processing failed" });
  }
});

// ============================================
// POST /api/admin/adjust-balance - Admin adjust user funds (+/-)
// ============================================
app.post("/api/admin/adjust-balance", async (req, res) => {
  try {
    const { ownerId, targetUserId, currency, amount, balanceType } = req.body;
    if (String(ownerId) !== "6965488457") {
      return res.status(403).json({ error: "Unauthorized" });
    }
    if (!targetUserId || !currency || amount === undefined || !balanceType) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const user = await getOrCreateUser(targetUserId);
    if (!user || user.telegramId === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Determine which field to adjust
    let field;
    if (currency === "dollar" && balanceType === "deposit") field = "dollarBalance";
    else if (currency === "dollar" && balanceType === "winning") field = "dollarWinning";
    else if (currency === "star" && balanceType === "deposit") field = "starBalance";
    else if (currency === "star" && balanceType === "winning") field = "starWinning";
    else return res.status(400).json({ error: "Invalid currency/balanceType" });

    const currentVal = user[field] || 0;
    const newVal = currentVal + amount;
    if (newVal < 0) {
      return res.status(400).json({ error: `Cannot go below 0. Current: ${currentVal}` });
    }

    user[field] = newVal;
    await user.save();

    // Log transaction
    await Transaction.create({
      telegramId: targetUserId,
      type: amount > 0 ? "bonus" : "withdraw",
      currency,
      amount,
      status: "completed",
      description: `Admin ${amount > 0 ? "added" : "removed"} ${Math.abs(amount)} ${currency} (${balanceType})`,
    });

    return res.json({
      success: true,
      field,
      oldValue: currentVal,
      newValue: newVal,
      dollarBalance: user.dollarBalance,
      starBalance: user.starBalance,
      dollarWinning: user.dollarWinning || 0,
      starWinning: user.starWinning || 0,
    });
  } catch (error) {
    console.error("Admin adjust error:", error);
    return res.status(500).json({ error: "Adjustment failed" });
  }
});

// ============================================
// POST /api/convert-stars - Convert Stars to Dollars
// Rate: 100 Stars = $1
// ============================================
const STAR_TO_DOLLAR_RATE = 100;

app.post("/api/convert-stars", async (req, res) => {
  try {
    const { userId, starAmount } = req.body;

    if (!userId || !starAmount || starAmount < STAR_TO_DOLLAR_RATE) {
      return res.status(400).json({ error: `Minimum ${STAR_TO_DOLLAR_RATE} Stars required` });
    }

    const user = await getOrCreateUser(userId);

    if (user.starBalance < starAmount) {
      return res.status(400).json({ error: "Insufficient Star balance" });
    }

    const dollarAmount = starAmount / STAR_TO_DOLLAR_RATE;

    user.starBalance -= starAmount;
    user.dollarBalance += dollarAmount;
    await user.save();

    // Log conversion transactions
    await Transaction.create({
      telegramId: userId,
      type: "convert",
      currency: "star",
      amount: -starAmount,
      status: "completed",
      description: `Converted ${starAmount} ⭐ → $${dollarAmount.toFixed(2)}`,
    });

    return res.json({
      success: true,
      starBalance: user.starBalance,
      dollarBalance: user.dollarBalance,
      converted: { stars: starAmount, dollars: dollarAmount },
    });
  } catch (error) {
    console.error("Convert error:", error);
    return res.status(500).json({ error: "Conversion failed" });
  }
});

// ============================================
// POST /api/game/result - Report game result
// ============================================
app.post("/api/game/result", async (req, res) => {
  try {
    const { userId, betAmount, winAmount, currency, game } = req.body;

    if (!userId || betAmount === undefined || winAmount === undefined || !currency || !game) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const user = await getOrCreateUser(userId);
    const balanceField = currency === "dollar" ? "dollarBalance" : "starBalance";
    const winningField = currency === "dollar" ? "dollarWinning" : "starWinning";

    const walletBalance = user[balanceField] || 0;
    const winningBalance = user[winningField] || 0;
    const totalPlayable = walletBalance + winningBalance;

    // Bet deducts from combined playable amount: first wallet, then winning
    if (betAmount > 0) {
      if (totalPlayable < betAmount) {
        return res.status(400).json({ error: "Insufficient combined balance" });
      }

      const deductFromWallet = Math.min(walletBalance, betAmount);
      const remainingAfterWallet = betAmount - deductFromWallet;

      user[balanceField] = walletBalance - deductFromWallet;
      user[winningField] = winningBalance - remainingAfterWallet;
    }

    // Win adds to winning pool
    if (winAmount > 0) {
      user[winningField] = (user[winningField] || 0) + winAmount;
    }

    await user.save();

    if (winAmount > 0) {
      await Transaction.create({
        telegramId: userId,
        type: "win",
        currency,
        amount: winAmount,
        status: "completed",
        game,
        description: `${game}: Bet ${betAmount}, Won ${winAmount}`,
      });
    }
    if (betAmount > 0) {
      await Transaction.create({
        telegramId: userId,
        type: "bet",
        currency,
        amount: -betAmount,
        status: "completed",
        game,
        description: `${game}: Bet ${betAmount}`,
      });
    }

    return res.json({
      dollarBalance: user.dollarBalance,
      starBalance: user.starBalance,
      dollarWinning: user.dollarWinning || 0,
      starWinning: user.starWinning || 0,
    });
  } catch (error) {
    console.error("Game result error:", error);
    return res.status(500).json({ error: "Failed to process game result" });
  }
});

// ============================================
// Telegram Bot /start command via webhook
// ============================================
app.post("/api/telegram-webhook", async (req, res) => {
  try {
    const update = req.body;

    // Handle /start command (with or without referral parameter)
    if (update.message?.text && update.message.text.startsWith("/start")) {
      const chatId = update.message.chat.id;
      const firstName = update.message.from.first_name || "Player";
      const fromId = update.message.from.id;
      const messageText = update.message.text.trim();

      // Extract referral parameter: "/start ref_123456" → "ref_123456"
      const parts = messageText.split(" ");
      const startParam = parts.length > 1 ? parts[1] : null;

      const webAppUrl = process.env.WEBAPP_URL || process.env.KOYEB_URL || "https://broken-bria-chetan1-ea890b93.koyeb.app";

      // If referral link, process referral and open app with startapp param
      if (startParam && startParam.startsWith("ref_")) {
        const referrerId = startParam.replace("ref_", "");

        // Process referral in backend directly
        try {
          const numericUserId = Number(fromId);
          const numericReferrerId = Number(referrerId);

          if (numericUserId && numericReferrerId && numericUserId !== numericReferrerId) {
            const user = await getOrCreateUser(numericUserId);
            const referrer = await getOrCreateUser(numericReferrerId);

            if (referrer && referrer.telegramId !== 0 && !user.referredBy) {
              user.referredBy = numericReferrerId;
              user.username = update.message.from.username || undefined;
              user.firstName = update.message.from.first_name || undefined;
              user.lastName = update.message.from.last_name || undefined;
              await user.save();

              referrer.referralCount = (referrer.referralCount || 0) + 1;
              const count = referrer.referralCount;
              await referrer.save();

              // Reward unlocks only after referred user makes a deposit
              try {
                await bot.sendMessage(numericReferrerId,
                  `🎉 *New Referral!*\n\n` +
                  `👤 ${firstName} joined using your link!\n` +
                  `🔒 Reward of 5 ⭐ will unlock once they make their first deposit.\n` +
                  `📊 Total referrals: ${count}`,
                  { parse_mode: "Markdown" }
                );
              } catch (notifErr) {
                console.error("Referral notification error:", notifErr.message);
              }
            }
          }
        } catch (refErr) {
          console.error("Webhook referral error:", refErr.message);
        }
      }

      // Send welcome message with Play button (startapp param included for Mini App)
      const appUrl = startParam 
        ? `${webAppUrl}?startapp=${startParam}` 
        : webAppUrl;

      await bot.sendMessage(chatId, `🎮 Welcome ${firstName} to Royal King Game!\n\nTap the button below to start playing!`, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🎮 Play Now",
                web_app: { url: appUrl },
              },
            ],
          ],
        },
      });

      return res.sendStatus(200);
    }

    // Handle /admin command - only for owner
    if (update.message?.text === "/admin") {
      const chatId = update.message.chat.id;
      const fromId = update.message.from.id;

      if (String(fromId) !== "6965488457") {
        await bot.sendMessage(chatId, "⛔ You are not authorized to access the admin panel.");
        return res.sendStatus(200);
      }

      const webAppUrl = process.env.WEBAPP_URL || process.env.KOYEB_URL || "https://broken-bria-chetan1-ea890b93.koyeb.app";
      await bot.sendMessage(chatId, "👑 Admin Panel\n\nTap below to open the admin dashboard:", {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🛡️ Open Admin Panel",
                web_app: { url: `${webAppUrl}/admin` },
              },
            ],
          ],
        },
      });

      return res.sendStatus(200);
    }

    // Handle /post command - send photo + Play Now button to channel/group
    if (update.message?.text && update.message.text.startsWith("/post")) {
      const chatId = update.message.chat.id;
      const fromId = update.message.from.id;

      if (String(fromId) !== "6965488457") {
        await bot.sendMessage(chatId, "⛔ You are not authorized to use /post.");
        return res.sendStatus(200);
      }

      const webAppUrl = process.env.WEBAPP_URL || process.env.KOYEB_URL || "https://broken-bria-chetan1-ea890b93.koyeb.app";

      // Check if replying to a photo
      const replyMsg = update.message.reply_to_message;
      const postText = update.message.text.replace("/post", "").trim();

      if (replyMsg && replyMsg.photo && replyMsg.photo.length > 0) {
        // Reply to photo mode: /post @channel caption text
        const parts = postText.split(" ");
        const targetChat = parts[0];
        const caption = parts.slice(1).join(" ") || "🎮 Royal King Game - Play Now!";

        if (!targetChat) {
          await bot.sendMessage(chatId, "⚠️ Reply to a photo and use:\n/post <channel\\_id> Caption text\n\n📌 *Private channel/group:*\nChat ID use karo (e.g. `-1001234567890`)\n\n📌 *Public channel:*\n`@channel_username` use karo\n\n🔍 *Private channel ID kaise pata kare:*\nChannel mein koi message forward karo @userinfobot ko, woh ID de dega.\n\nExample:\n`/post -1001234567890 🎮 Play Royal King Game now!`\n`/post @MyChannel 🎮 Play now!`", { parse_mode: "Markdown" });
          return res.sendStatus(200);
        }

        const photoId = replyMsg.photo[replyMsg.photo.length - 1].file_id;

        try {
          await bot.sendPhoto(targetChat, photoId, {
            caption: caption,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🎮 Play Now", url: "https://t.me/RoyalKingGameBot/RoyalKingGame" }],
              ],
            },
          });
          await bot.sendMessage(chatId, `✅ Post sent to ${targetChat} successfully!`);
        } catch (err) {
          await bot.sendMessage(chatId, `❌ Failed to send: ${err.message}\n\nMake sure bot is admin in the channel/group.`);
        }

        return res.sendStatus(200);
      }

      // No reply mode: /post @channel photo_url caption
      const parts = postText.split(" ");
      if (parts.length < 2) {
        await bot.sendMessage(chatId, 
          "⚠️ *Usage:*\n\n" +
          "*Method 1:* Reply to a photo:\n`/post <chat\\_id> Caption text`\n\n" +
          "*Method 2:* With photo URL:\n`/post <chat\\_id> https://photo-url.jpg Caption text`\n\n" +
          "📌 *Private channel/group* → Chat ID use karo:\n`-1001234567890`\n" +
          "📌 *Public channel* → Username use karo:\n`@MyChannel`\n\n" +
          "🔍 *ID kaise pata kare:*\nChannel se msg forward karo @userinfobot ko\n\n" +
          "Examples:\n" +
          "`/post -1001234567890 https://example.com/banner.jpg 🎮 Play now!`\n" +
          "`/post @MyChannel https://example.com/img.jpg Join the fun!`",
          { parse_mode: "Markdown" }
        );
        return res.sendStatus(200);
      }

      const targetChat = parts[0];
      let photoUrl = parts[1];
      let caption = parts.slice(2).join(" ") || "🎮 Royal King Game - Play Now!";

      // Check if second part is a URL
      if (!photoUrl.startsWith("http")) {
        // No URL provided, treat as caption
        caption = parts.slice(1).join(" ");
        await bot.sendMessage(chatId, "⚠️ Photo URL missing. Use:\n`/post <chat\\_id> https://photo-url.jpg Caption`\n\nOr reply to a photo with:\n`/post <chat\\_id> Caption`\n\n📌 Private channel ke liye chat ID use karo: `-1001234567890`", { parse_mode: "Markdown" });
        return res.sendStatus(200);
      }

      try {
        await bot.sendPhoto(targetChat, photoUrl, {
          caption: caption,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🎮 Play Now", url: "https://t.me/RoyalKingGameBot/RoyalKingGame" }],
            ],
          },
        });
        await bot.sendMessage(chatId, `✅ Post sent to ${targetChat} successfully!`);
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Failed to send: ${err.message}\n\nMake sure bot is admin in the channel/group.`);
      }

      return res.sendStatus(200);
    }

    // Handle /cancelbroadcast - stop any running broadcast
    if (update.message?.text && update.message.text.trim().startsWith("/cancelbroadcast")) {
      const chatId = update.message.chat.id;
      const fromId = update.message.from.id;
      if (String(fromId) !== "6965488457") {
        await bot.sendMessage(chatId, "⛔ You are not authorized.");
        return res.sendStatus(200);
      }
      if (global.__broadcastRunning) {
        global.__broadcastCancel = true;
        await bot.sendMessage(chatId, "🛑 Cancel signal sent. Broadcast will stop shortly...");
      } else {
        await bot.sendMessage(chatId, "ℹ️ No broadcast is currently running.");
      }
      return res.sendStatus(200);
    }

    // Handle /broadcast command - only for owner
    if (update.message?.text && update.message.text.startsWith("/broadcast") && !update.message.text.startsWith("/broadcastgame")) {
      const chatId = update.message.chat.id;
      const fromId = update.message.from.id;

      if (String(fromId) !== "6965488457") {
        await bot.sendMessage(chatId, "⛔ You are not authorized to use broadcast.");
        return res.sendStatus(200);
      }

      if (global.__broadcastRunning) {
        await bot.sendMessage(chatId, "⚠️ A broadcast is already running. Use /cancelbroadcast first.");
        return res.sendStatus(200);
      }

      const broadcastText = update.message.text.replace("/broadcast", "").trim();
      if (!broadcastText) {
        await bot.sendMessage(chatId, "⚠️ Usage: /broadcast Your message here\n\nExample:\n/broadcast 🎉 New update! Check out our latest games!\n\nTip: use /cancelbroadcast to stop a running broadcast.");
        return res.sendStatus(200);
      }

      // Get all users
      const allUsers = await User.find({ telegramId: { $gt: 0 } }).select("telegramId").lean();
      let sent = 0;
      let failed = 0;
      let cancelled = false;

      global.__broadcastRunning = true;
      global.__broadcastCancel = false;

      await bot.sendMessage(chatId, `📡 Broadcasting to ${allUsers.length} users...\n\nSend /cancelbroadcast to stop.`);

      for (const user of allUsers) {
        if (global.__broadcastCancel) { cancelled = true; break; }
        try {
          await bot.sendMessage(user.telegramId, broadcastText, { parse_mode: "Markdown" });
          sent++;
        } catch (err) {
          failed++;
        }
        // Small delay to avoid Telegram rate limits
        if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1000));
      }

      global.__broadcastRunning = false;
      global.__broadcastCancel = false;

      await bot.sendMessage(chatId, `${cancelled ? "🛑 Broadcast cancelled." : "✅ Broadcast complete!"}\n\n📨 Sent: ${sent}\n❌ Failed: ${failed}\n👥 Total: ${allUsers.length}`);

      return res.sendStatus(200);
    }

    // Handle /broadcastgame command - send a specific game to all users with Play button
    // Usage: /broadcastgame <gameKey> <message>
    // gameKey: aviator | mines | dice | carnival | greedy
    if (update.message?.text && update.message.text.startsWith("/broadcastgame")) {
      const chatId = update.message.chat.id;
      const fromId = update.message.from.id;

      if (String(fromId) !== "6965488457") {
        await bot.sendMessage(chatId, "⛔ You are not authorized to use broadcastgame.");
        return res.sendStatus(200);
      }

      const args = update.message.text.replace("/broadcastgame", "").trim();
      const parts = args.split(/\s+/);
      const gameKey = (parts[0] || "").toLowerCase();
      const customMsg = parts.slice(1).join(" ").trim();

      const GAMES = {
        aviator:  { startapp: "g_aviator",  title: "✈️ Aviator",        emoji: "✈️" },
        mines:    { startapp: "g_mines",    title: "💣 Mines",          emoji: "💣" },
        dice:     { startapp: "g_dice",     title: "🎲 Dice Master",    emoji: "🎲" },
        carnival: { startapp: "g_carnival", title: "🎡 Carnival Spin",  emoji: "🎡" },
        greedy:   { startapp: "g_greedy",   title: "👑 Greedy King",    emoji: "👑" },
      };

      const game = GAMES[gameKey];
      if (!game) {
        await bot.sendMessage(
          chatId,
          "⚠️ Usage: `/broadcastgame <game> <optional message>`\n\n" +
          "Available games:\n" +
          "• `aviator` — Aviator\n" +
          "• `mines` — Mines\n" +
          "• `dice` — Dice Master\n" +
          "• `carnival` — Carnival Spin\n" +
          "• `greedy` — Greedy King\n\n" +
          "Example:\n`/broadcastgame aviator 🚀 Big multipliers waiting!`",
          { parse_mode: "Markdown" }
        );
        return res.sendStatus(200);
      }

      const playUrl = `https://t.me/RoyalKingGameBot/RoyalKingGame?startapp=${game.startapp}`;
      const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const text = customMsg
        ? `${game.emoji} <b>${escapeHtml(game.title)}</b>\n\n${escapeHtml(customMsg)}`
        : `${game.emoji} <b>${escapeHtml(game.title)}</b> is live!\n\nTap below to play now and win big! 🏆`;

      const allUsers = await User.find({ telegramId: { $gt: 0 } }).select("telegramId").lean();
      let sent = 0;
      let failed = 0;
      let cancelled = false;

      if (global.__broadcastRunning) {
        await bot.sendMessage(chatId, "⚠️ A broadcast is already running. Use /cancelbroadcast first.");
        return res.sendStatus(200);
      }
      global.__broadcastRunning = true;
      global.__broadcastCancel = false;

      await bot.sendMessage(chatId, `📡 Broadcasting ${game.title} to ${allUsers.length} users...\n\nSend /cancelbroadcast to stop.`);

      const replyMarkup = {
        inline_keyboard: [
          [{ text: `▶️ Play ${game.title}`, url: playUrl }],
        ],
      };

      for (const user of allUsers) {
        if (global.__broadcastCancel) { cancelled = true; break; }
        try {
          await bot.sendMessage(user.telegramId, text, {
            parse_mode: "HTML",
            reply_markup: replyMarkup,
          });
          sent++;
        } catch (err) {
          // Retry without parse_mode so the Play button still gets delivered
          try {
            await bot.sendMessage(user.telegramId, customMsg ? `${game.emoji} ${game.title}\n\n${customMsg}` : `${game.emoji} ${game.title} is live!\n\nTap below to play now and win big! 🏆`, {
              reply_markup: replyMarkup,
            });
            sent++;
          } catch (e2) {
            failed++;
          }
        }
        if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1000));
      }

      global.__broadcastRunning = false;
      global.__broadcastCancel = false;

      await bot.sendMessage(chatId, `${cancelled ? "🛑 Game broadcast cancelled." : "✅ Game broadcast complete!"}\n\n🎮 Game: ${game.title}\n📨 Sent: ${sent}\n❌ Failed: ${failed}\n👥 Total: ${allUsers.length}`);

      return res.sendStatus(200);
    }
    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      const payload = JSON.parse(payment.invoice_payload);
      const { userId, currency, amount } = payload;

      const user = await getOrCreateUser(userId);

      if (currency === "star") {
        user.starBalance += amount;
      } else if (currency === "dollar") {
        user.dollarBalance += amount;
      }
      await user.save();

      await Transaction.create({
        telegramId: userId,
        type: "deposit",
        currency,
        amount: amount,
        status: "completed",
        telegramPaymentId: payment.telegram_payment_charge_id,
        description: `Deposit of ${currency === "dollar" ? "$" + amount : amount + " Stars"}`,
      });

      console.log(`✅ Payment received: ${amount} ${currency} for user ${userId}`);

      // Unlock pending referral reward (if any) on first successful deposit
      await creditReferralOnDeposit(userId);
    }

    // Handle pre-checkout query
    if (update.pre_checkout_query) {
      await bot.answerPreCheckoutQuery(update.pre_checkout_query.id, true);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error);
    res.sendStatus(200);
  }
});

// ============================================
// TON Wallet Integration
// ============================================
const OWNER_TON_WALLET = process.env.OWNER_TON_WALLET || "";

// Helper: Fetch TON/USD price from CoinGecko
async function getTonUsdPrice() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd");
    const data = await res.json();
    return data["the-open-network"]?.usd || 2.5; // fallback price
  } catch {
    return 2.5; // fallback
  }
}

// POST /api/ton/init-deposit - Get owner wallet + create pending deposit
app.post("/api/ton/init-deposit", async (req, res) => {
  try {
    const { userId, tonAmount } = req.body;
    if (!userId || !tonAmount || tonAmount <= 0) {
      return res.status(400).json({ error: "Missing userId or tonAmount" });
    }
    if (!OWNER_TON_WALLET) {
      return res.status(500).json({ error: "Owner TON wallet not configured" });
    }

    const tonPrice = await getTonUsdPrice();
    const usdEquivalent = tonAmount * tonPrice;

    // Create unique deposit comment
    const depositComment = `deposit_${userId}_${Date.now()}`;

    // Create pending transaction
    const tx = await Transaction.create({
      telegramId: Number(userId),
      type: "ton_deposit",
      currency: "ton",
      amount: tonAmount,
      status: "pending",
      tonAmount: tonAmount,
      tonReceiverAddress: OWNER_TON_WALLET,
      depositComment,
      usdEquivalent,
      description: `TON Deposit: ${tonAmount} TON ≈ $${usdEquivalent.toFixed(2)}`,
    });

    return res.json({
      ownerWallet: OWNER_TON_WALLET,
      depositComment,
      tonAmount,
      usdEquivalent,
      tonPrice,
      transactionId: tx._id,
    });
  } catch (error) {
    console.error("TON init-deposit error:", error);
    return res.status(500).json({ error: "Failed to init TON deposit" });
  }
});

// POST /api/ton/confirm-deposit - Confirm deposit after user sends TON
app.post("/api/ton/confirm-deposit", async (req, res) => {
  try {
    const { userId, transactionId, bocHash } = req.body;
    if (!userId || !transactionId) {
      return res.status(400).json({ error: "Missing userId or transactionId" });
    }

    const tx = await Transaction.findById(transactionId);
    if (!tx || tx.status !== "pending" || tx.type !== "ton_deposit") {
      return res.status(400).json({ error: "Invalid or already processed transaction" });
    }
    if (tx.telegramId !== Number(userId)) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Mark as completed and credit user balance
    tx.status = "completed";
    tx.tonTxHash = bocHash || "tonconnect_confirmed";
    await tx.save();

    const user = await getOrCreateUser(userId);
    user.dollarBalance += tx.usdEquivalent;
    await user.save();

    console.log(`✅ TON Deposit: ${tx.tonAmount} TON ($${tx.usdEquivalent.toFixed(2)}) for user ${userId}`);

    return res.json({
      success: true,
      credited: tx.usdEquivalent,
      dollarBalance: user.dollarBalance,
      starBalance: user.starBalance,
    });
  } catch (error) {
    console.error("TON confirm-deposit error:", error);
    return res.status(500).json({ error: "Failed to confirm TON deposit" });
  }
});

// POST /api/ton/withdraw - Withdraw dollars via TON
app.post("/api/ton/withdraw", async (req, res) => {
  try {
    const { userId, dollarAmount, tonWalletAddress } = req.body;
    if (!userId || !dollarAmount || !tonWalletAddress) {
      return res.status(400).json({ error: "Missing userId, dollarAmount, or tonWalletAddress" });
    }
    if (dollarAmount < 10) {
      return res.status(400).json({ error: "Minimum withdrawal is $10" });
    }

    const user = await getOrCreateUser(userId);
    if ((user.dollarWinning || 0) < dollarAmount) {
      return res.status(400).json({ error: "Insufficient winning balance. Withdrawals are only from winnings." });
    }

    const tonPrice = await getTonUsdPrice();
    const tonAmount = dollarAmount / tonPrice;

    // Deduct from winning
    user.dollarWinning -= dollarAmount;
    await user.save();

    // Create withdrawal transaction (owner will process manually)
    await Transaction.create({
      telegramId: Number(userId),
      type: "ton_withdraw",
      currency: "ton",
      amount: -dollarAmount,
      tonAmount,
      tonReceiverAddress: tonWalletAddress,
      usdEquivalent: dollarAmount,
      status: "pending",
      description: `TON Withdraw: $${dollarAmount} ≈ ${tonAmount.toFixed(4)} TON → ${tonWalletAddress.slice(0, 8)}...`,
    });

    // Notify owner via Telegram
    try {
      await bot.sendMessage(6965488457, 
        `💰 TON Withdrawal Request!\n\nUser: ${userId}\nAmount: $${dollarAmount} ≈ ${tonAmount.toFixed(4)} TON\nSend to: \`${tonWalletAddress}\`\nTON Price: $${tonPrice.toFixed(2)}`,
        { parse_mode: "Markdown" }
      );
    } catch (e) {
      console.error("Failed to notify owner:", e.message);
    }

    return res.json({
      success: true,
      tonAmount,
      tonPrice,
      dollarAmount,
      dollarBalance: user.dollarBalance,
      starBalance: user.starBalance,
      message: "Withdrawal request submitted. TON will be sent to your wallet shortly.",
    });
  } catch (error) {
    console.error("TON withdraw error:", error);
    return res.status(500).json({ error: "Withdrawal failed" });
  }
});

// POST /api/ton/price - Get current TON price
app.get("/api/ton/price", async (req, res) => {
  try {
    const price = await getTonUsdPrice();
    return res.json({ tonUsdPrice: price });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch price" });
  }
});

// ============================================
// POST /api/winnings - Get user winnings (only from game wins)
// ============================================
app.post("/api/winnings", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const numericId = Number(userId);
    if (!numericId || isNaN(numericId)) {
      return res.json({ dollarWinnings: 0, starWinnings: 0 });
    }

    // Winnings = ONLY sum of win transactions
    // Deposits = sum of deposit transactions (to subtract from withdrawable)
    const dollarWins = await Transaction.aggregate([
      { $match: { telegramId: numericId, type: "win", currency: "dollar", status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const starWins = await Transaction.aggregate([
      { $match: { telegramId: numericId, type: "win", currency: "star", status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const dollarDeposits = await Transaction.aggregate([
      { $match: { telegramId: numericId, type: "deposit", currency: "dollar", status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const starDeposits = await Transaction.aggregate([
      { $match: { telegramId: numericId, type: "deposit", currency: "star", status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    return res.json({
      dollarWinnings: Math.max(0, dollarWins[0]?.total || 0),
      starWinnings: Math.max(0, starWins[0]?.total || 0),
      dollarDeposits: Math.max(0, dollarDeposits[0]?.total || 0),
      starDeposits: Math.max(0, starDeposits[0]?.total || 0),
    });
  } catch (error) {
    console.error("Winnings error:", error);
    return res.status(500).json({ error: "Failed to fetch winnings" });
  }
});

// ============================================
// NOWPayments Crypto Payment Gateway
// ============================================
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || "";
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET || "";
const NOWPAYMENTS_API = "https://api.nowpayments.io/v1";

// POST /api/crypto/create-payment - Create NOWPayments direct payment
app.post("/api/crypto/create-payment", async (req, res) => {
  try {
    const { userId, amount, currency } = req.body;
    if (!userId || !amount || !currency) {
      return res.status(400).json({ error: "Missing userId, amount, or currency" });
    }
    if (!NOWPAYMENTS_API_KEY) {
      return res.status(500).json({ error: "NOWPayments not configured" });
    }

    // Check minimum amount for this currency
    const minRes = await fetch(`${NOWPAYMENTS_API}/min-amount?currency_from=${currency}&currency_to=usd&fiat_equivalent=usd`, {
      headers: { "x-api-key": NOWPAYMENTS_API_KEY },
    });
    if (minRes.ok) {
      const minData = await minRes.json();
      const minUsd = minData.fiat_equivalent || null;
      if (minUsd && amount < minUsd) {
        return res.status(400).json({ 
          error: `Minimum deposit for ${currency.toUpperCase()} is $${Math.ceil(minUsd)}. Please increase your amount.` 
        });
      }
    }

    const orderId = `dep_${userId}_${Date.now()}`;

    // Use /payment endpoint for direct address (no hosted page)
    const npRes = await fetch(`${NOWPAYMENTS_API}/payment`, {
      method: "POST",
      headers: {
        "x-api-key": NOWPAYMENTS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        price_amount: amount,
        price_currency: "usd",
        pay_currency: currency,
        order_id: orderId,
        order_description: `Deposit $${amount} for user ${userId}`,
        ipn_callback_url: `${process.env.KOYEB_URL || "https://broken-bria-chetan1-ea890b93.koyeb.app"}/api/crypto/ipn`,
      }),
    });

    const npData = await npRes.json();
    console.log("NOWPayments /payment response:", JSON.stringify(npData));
    if (!npRes.ok) {
      console.error("NOWPayments error:", npData);
      throw new Error(npData.message || "Failed to create payment");
    }

    // Save pending transaction
    await Transaction.create({
      telegramId: Number(userId),
      type: "deposit",
      currency: "dollar",
      amount: amount,
      status: "pending",
      description: `Crypto Deposit: $${amount} via ${currency.toUpperCase()}`,
      depositComment: orderId,
      tonTxHash: String(npData.payment_id || npData.id),
    });

    return res.json({
      payAddress: npData.pay_address,
      payAmount: npData.pay_amount,
      payCurrency: npData.pay_currency,
      paymentId: npData.payment_id,
      orderId,
      expirationEstimate: npData.expiration_estimate_date,
    });
  } catch (error) {
    console.error("Crypto create-payment error:", error);
    return res.status(500).json({ error: error.message || "Failed to create crypto payment" });
  }
});

// POST /api/crypto/ipn - NOWPayments IPN (Instant Payment Notification) callback
app.post("/api/crypto/ipn", async (req, res) => {
  try {
    const data = req.body;
    console.log("📩 NOWPayments IPN:", JSON.stringify(data));

    // Verify IPN signature - NOWPayments sends signature in x-nowpayments-sig header
    if (NOWPAYMENTS_IPN_SECRET) {
      const crypto = require("crypto");
      const receivedSig = req.headers["x-nowpayments-sig"];
      console.log("🔑 Received signature header:", receivedSig ? receivedSig.substring(0, 20) + "..." : "MISSING");
      
      if (!receivedSig) {
        console.error("❌ No x-nowpayments-sig header found");
        return res.status(400).json({ error: "Missing signature header" });
      }
      
      // Use raw body to preserve exact number formatting
      const rawBody = req.rawBody;
      let rawData;
      try {
        rawData = JSON.parse(rawBody);
      } catch (e) {
        rawData = data;
      }
      const sortedKeys = Object.keys(rawData).sort();
      const sortedData = {};
      for (const k of sortedKeys) {
        sortedData[k] = rawData[k];
      }
      const hmac = crypto.createHmac("sha512", NOWPAYMENTS_IPN_SECRET)
        .update(JSON.stringify(sortedData))
        .digest("hex");
      console.log("🔑 IPN signature check - received:", receivedSig.substring(0, 20) + "...", "computed:", hmac.substring(0, 20) + "...");
      if (hmac !== receivedSig) {
        console.error("❌ IPN signature mismatch");
        console.error("Raw body:", rawBody);
        return res.status(400).json({ error: "Invalid signature" });
      }
      console.log("✅ IPN signature verified");
    }

    const { order_id, payment_status, price_amount } = data;

    if (!order_id) {
      return res.status(400).json({ error: "Missing order_id" });
    }

    // Find matching pending transaction
    const tx = await Transaction.findOne({ depositComment: order_id, status: "pending" });
    if (!tx) {
      console.log("No pending tx for order:", order_id);
      return res.sendStatus(200);
    }

    if (payment_status === "finished" || payment_status === "confirmed") {
      tx.status = "completed";
      await tx.save();

      // Credit user balance
      const user = await getOrCreateUser(tx.telegramId);
      user.dollarBalance += Number(price_amount || tx.amount);
      await user.save();

      console.log(`✅ Crypto deposit completed: $${tx.amount} for user ${tx.telegramId}`);

      // Unlock pending referral reward (if any) on first successful deposit
      await creditReferralOnDeposit(tx.telegramId);

      // Notify user via Telegram bot
      try {
        await bot.sendMessage(tx.telegramId,
          `✅ Payment Received!\n\n💰 $${tx.amount} has been added to your wallet.\n\nOpen the game to start playing! 🎮`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🎮 Open Game", web_app: { url: process.env.WEBAPP_URL || process.env.KOYEB_URL || "https://broken-bria-chetan1-ea890b93.koyeb.app" } }],
              ],
            },
          }
        );
      } catch (e) { console.error("Failed to notify user:", e.message); }

      // Notify owner
      try {
        await bot.sendMessage(6965488457,
          `💰 Crypto Deposit!\n\nUser: ${tx.telegramId}\nAmount: $${tx.amount}\nOrder: ${order_id}\nStatus: ${payment_status}`
        );
      } catch (e) { /* ignore */ }
    } else if (payment_status === "failed" || payment_status === "expired") {
      tx.status = "failed";
      await tx.save();
      console.log(`❌ Crypto deposit failed: ${order_id} - ${payment_status}`);
    }
    // For other statuses (waiting, confirming, sending) - do nothing, keep pending

    return res.sendStatus(200);
  } catch (error) {
    console.error("Crypto IPN error:", error);
    return res.sendStatus(200); // Always return 200 to NOWPayments
  }
});

// GET /api/crypto/currencies - Get available cryptocurrencies
app.get("/api/crypto/currencies", async (req, res) => {
  try {
    if (!NOWPAYMENTS_API_KEY) {
      // Return popular defaults if API key not set
      return res.json({ currencies: ["btc", "eth", "usdt", "ltc", "ton", "trx", "sol", "doge"] });
    }
    const npRes = await fetch(`${NOWPAYMENTS_API}/currencies`, {
      headers: { "x-api-key": NOWPAYMENTS_API_KEY },
    });
    const data = await npRes.json();
    return res.json({ currencies: data.currencies || [] });
  } catch (error) {
    return res.json({ currencies: ["btc", "eth", "usdt", "ltc", "ton", "trx", "sol", "doge"] });
  }
});

// GET /api/crypto/min-amount - Get minimum payment amount
app.get("/api/crypto/min-amount", async (req, res) => {
  try {
    const { currency } = req.query;
    if (!currency || !NOWPAYMENTS_API_KEY) {
      return res.json({ min_amount: 1 });
    }
    const npRes = await fetch(`${NOWPAYMENTS_API}/min-amount?currency_from=${currency}&currency_to=usd`, {
      headers: { "x-api-key": NOWPAYMENTS_API_KEY },
    });
    const data = await npRes.json();
    return res.json({ min_amount: data.min_amount || 1 });
  } catch (error) {
    return res.json({ min_amount: 1 });
  }
});

// POST /api/crypto/check-status - Check payment status
app.post("/api/crypto/check-status", async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    const tx = await Transaction.findOne({ depositComment: orderId });
    if (!tx) return res.status(404).json({ error: "Transaction not found" });

    return res.json({ status: tx.status, amount: tx.amount });
  } catch (error) {
    return res.status(500).json({ error: "Failed to check status" });
  }
});

// ============================================
// GREEDY KING MULTIPLAYER ROUND SYSTEM
// ============================================
const FOOD_ITEMS_SERVER = [
  { emoji: "🌭", name: "Hot Dog", multiplier: 10 },
  { emoji: "🥩", name: "BBQ", multiplier: 15 },
  { emoji: "🍗", name: "Chicken", multiplier: 25 },
  { emoji: "🥓", name: "Steak", multiplier: 45 },
  { emoji: "🌽", name: "Corn", multiplier: 5 },
  { emoji: "🥬", name: "Cabbage", multiplier: 5 },
  { emoji: "🍅", name: "Tomato", multiplier: 5 },
  { emoji: "🥕", name: "Carrot", multiplier: 5 },
];

// In-memory round state
const greedyKingState = {
  roundNumber: 1,
  phase: "betting", // betting, countdown, spinning, result
  phaseStartTime: Date.now(),
  winnerIndex: null,
  lastResults: [], // last 12 emoji results
};

// Phase durations in ms
const PHASE_DURATIONS = {
  betting: 15000,
  countdown: 3000,
  spinning: 4000,
  result: 4000,
};

function getPhaseTimeLeft() {
  const elapsed = Date.now() - greedyKingState.phaseStartTime;
  const duration = PHASE_DURATIONS[greedyKingState.phase];
  return Math.max(0, Math.ceil((duration - elapsed) / 1000));
}

async function advancePhase() {
  const { phase } = greedyKingState;

  if (phase === "betting") {
    greedyKingState.phase = "countdown";
    greedyKingState.phaseStartTime = Date.now();
    setTimeout(advancePhase, PHASE_DURATIONS.countdown);
  } else if (phase === "countdown") {
    greedyKingState.phase = "spinning";
    greedyKingState.phaseStartTime = Date.now();

    // Determine winner: fruit with LOWEST total payout (totalBet × multiplier).
    // This guarantees house edge — admin always picks the cheapest outcome.
    // Empty fruits (payout 0) are preferred so untouched fruits win first.
    const roundNum = greedyKingState.roundNumber;
    const bets = await GameBet.find({ roundNumber: roundNum });

    const totalPerFruit = FOOD_ITEMS_SERVER.map(() => 0);
    bets.forEach((b) => {
      totalPerFruit[b.fruitIndex] += b.amount;
    });

    // Payout per fruit = total bets on it × its multiplier
    const payoutPerFruit = totalPerFruit.map((t, i) => t * FOOD_ITEMS_SERVER[i].multiplier);

    // Add tiny random tiebreaker so equal payouts pick randomly
    const withJitter = payoutPerFruit.map((p) => p + Math.random() * 0.001);
    const minVal = Math.min(...withJitter);
    const minFruits = withJitter.map((v, i) => (v === minVal ? i : -1)).filter((i) => i !== -1);
    const winnerIdx = minFruits[Math.floor(Math.random() * minFruits.length)];

    greedyKingState.winnerIndex = winnerIdx;

    // Process results after spin duration
    setTimeout(async () => {
      // Process all bets for this round
      const roundBets = await GameBet.find({ roundNumber: roundNum });
      const playerBets = {};

      // Group bets by player
      roundBets.forEach((b) => {
        const key = `${b.telegramId}_${b.currency}`;
        if (!playerBets[key]) {
          playerBets[key] = { telegramId: b.telegramId, currency: b.currency, bets: FOOD_ITEMS_SERVER.map(() => 0), totalBet: 0 };
        }
        playerBets[key].bets[b.fruitIndex] += b.amount;
        playerBets[key].totalBet += b.amount;
      });

      // Process each player's result
      for (const player of Object.values(playerBets)) {
        const betOnWinner = player.bets[winnerIdx];
        const totalBet = player.totalBet;
        let winAmount = 0;

        if (betOnWinner > 0) {
          winAmount = betOnWinner * FOOD_ITEMS_SERVER[winnerIdx].multiplier;
        }

        // Report to game/result endpoint logic
        try {
          const user = await getOrCreateUser(player.telegramId);
          const balanceField = player.currency === "dollar" ? "dollarBalance" : "starBalance";
          const winningField = player.currency === "dollar" ? "dollarWinning" : "starWinning";

          if (winAmount > 0) {
            user[winningField] = (user[winningField] || 0) + winAmount;
          }
          // Bet was already deducted when placed
          await user.save();

          if (winAmount > 0) {
            await Transaction.create({
              telegramId: player.telegramId, type: "win", currency: player.currency,
              amount: winAmount, status: "completed",
              description: `greedy-king: Bet ${totalBet}, Won ${winAmount} (Round ${roundNum})`,
              game: "greedy-king",
            });
          }
          if (totalBet > 0) {
            await Transaction.create({
              telegramId: player.telegramId, type: "bet", currency: player.currency,
              amount: -totalBet, status: "completed",
              description: `greedy-king: Bet ${totalBet} (Round ${roundNum})`,
              game: "greedy-king",
            });
          }
        } catch (err) {
          console.error("Greedy King result processing error:", err);
        }
      }

      // Update results history
      greedyKingState.lastResults = [
        FOOD_ITEMS_SERVER[winnerIdx].emoji,
        ...greedyKingState.lastResults,
      ].slice(0, 12);

      // Move to result phase
      greedyKingState.phase = "result";
      greedyKingState.phaseStartTime = Date.now();
      setTimeout(() => {
        greedyKingState.roundNumber++;
        greedyKingState.phase = "betting";
        greedyKingState.phaseStartTime = Date.now();
        greedyKingState.winnerIndex = null;
        setTimeout(advancePhase, PHASE_DURATIONS.betting);
      }, PHASE_DURATIONS.result);
    }, PHASE_DURATIONS.spinning);
  }
}

// Start the first round cycle
setTimeout(advancePhase, PHASE_DURATIONS.betting);

// GET /api/greedy-king/state - Get current round state
app.get("/api/greedy-king/state", async (req, res) => {
  try {
    const { currency } = req.query;
    const curr = currency || "dollar";
    const roundNum = greedyKingState.roundNumber;

    // Get all bets for current round with this currency
    const bets = await GameBet.find({ roundNumber: roundNum, currency: curr });

    // Aggregate per fruit
    const fruitBets = FOOD_ITEMS_SERVER.map(() => ({ totalAmount: 0, playerCount: 0, players: [] }));
    const playerSet = {};
    bets.forEach((b) => {
      fruitBets[b.fruitIndex].totalAmount += b.amount;
      if (!playerSet[`${b.telegramId}_${b.fruitIndex}`]) {
        playerSet[`${b.telegramId}_${b.fruitIndex}`] = true;
        fruitBets[b.fruitIndex].playerCount++;
        fruitBets[b.fruitIndex].players.push({ name: b.firstName, amount: b.amount });
      } else {
        // Update existing player amount
        const existing = fruitBets[b.fruitIndex].players.find(p => p.name === b.firstName);
        if (existing) existing.amount += b.amount;
      }
    });

    // Total unique players
    const uniquePlayers = new Set(bets.map((b) => b.telegramId)).size;

    return res.json({
      roundNumber: roundNum,
      phase: greedyKingState.phase,
      timeLeft: getPhaseTimeLeft(),
      winnerIndex: (greedyKingState.phase === "spinning" || greedyKingState.phase === "result") ? greedyKingState.winnerIndex : null,
      fruitBets: fruitBets.map((f) => ({ totalAmount: f.totalAmount, playerCount: f.playerCount, players: f.players.slice(0, 5) })),
      totalPlayers: uniquePlayers,
      lastResults: greedyKingState.lastResults,
    });
  } catch (error) {
    console.error("Greedy King state error:", error);
    return res.status(500).json({ error: "Failed to get game state" });
  }
});

// POST /api/greedy-king/bet - Place a bet
app.post("/api/greedy-king/bet", async (req, res) => {
  try {
    const { userId, fruitIndex, amount, currency, firstName } = req.body;

    if (!userId || fruitIndex === undefined || !amount || !currency) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (greedyKingState.phase !== "betting") {
      return res.status(400).json({ error: "Betting is closed for this round" });
    }

    if (fruitIndex < 0 || fruitIndex > 7) {
      return res.status(400).json({ error: "Invalid fruit index" });
    }

    const user = await getOrCreateUser(userId);
    const balanceField = currency === "dollar" ? "dollarBalance" : "starBalance";
    const winningField = currency === "dollar" ? "dollarWinning" : "starWinning";
    const walletBal = user[balanceField] || 0;
    const winningBal = user[winningField] || 0;
    const totalPlayable = walletBal + winningBal;

    if (totalPlayable < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Deduct balance immediately (wallet first, then winning)
    const deductFromWallet = Math.min(walletBal, amount);
    const deductFromWinning = amount - deductFromWallet;
    user[balanceField] = walletBal - deductFromWallet;
    user[winningField] = winningBal - deductFromWinning;
    await user.save();

    // Save bet
    await GameBet.create({
      roundNumber: greedyKingState.roundNumber,
      telegramId: Number(userId),
      firstName: firstName || "Player",
      fruitIndex,
      amount,
      currency,
    });

    return res.json({
      success: true,
      roundNumber: greedyKingState.roundNumber,
      dollarBalance: user.dollarBalance,
      starBalance: user.starBalance,
      dollarWinning: user.dollarWinning || 0,
      starWinning: user.starWinning || 0,
    });
  } catch (error) {
    console.error("Greedy King bet error:", error);
    return res.status(500).json({ error: "Failed to place bet" });
  }
});

// GET /api/greedy-king/my-bets - Get user's bets for current round
app.get("/api/greedy-king/my-bets", async (req, res) => {
  try {
    const { userId, currency } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const bets = await GameBet.find({
      roundNumber: greedyKingState.roundNumber,
      telegramId: Number(userId),
      currency: currency || "dollar",
    });

    const myBets = FOOD_ITEMS_SERVER.map(() => 0);
    bets.forEach((b) => {
      myBets[b.fruitIndex] += b.amount;
    });

    return res.json({ myBets, roundNumber: greedyKingState.roundNumber });
  } catch (error) {
    return res.status(500).json({ error: "Failed to get bets" });
  }
});

// ============================================
// AVIATOR MULTIPLAYER ROUND SYSTEM (server-synced, house-edge rigged)
// ============================================
const Setting = require("./models/Setting");

const AVIATOR_PHASE = {
  betting: 7000,    // 7s betting window
  flying:  60000,   // hard cap, fallback only
  crashed: 4000,    // 4s show crash result
};

// Multiplier formula must match frontend (deterministic by elapsed time)
function aviatorMultiplierAt(elapsedMs) {
  const elapsedSec = elapsedMs / 1000;
  return Math.pow(1.075, elapsedSec * 1.8);
}
function aviatorTimeForMultiplier(target) {
  // inverse of formula above
  return (Math.log(target) / Math.log(1.075) / 1.8) * 1000;
}

// In-memory aviator state per currency (separate pools for $ and ⭐)
function makeAviatorPool() {
  return {
    roundNumber: 1,
    phase: "betting",
    phaseStartTime: Date.now(),
    crashAt: 1.0,                // set when flying begins; can be brought down dynamically
    flightStartTime: 0,
    bets: {},                    // { "telegramId:slot": { userId, amount, firstName, cashedOutAt, winAmount } }
    history: [],                 // last 18 crash multipliers
    totalPool: 0,                // sum of all bets this round
    totalPaidOut: 0,             // running sum of cashouts
    userCooldown: {},            // { telegramId: cooldownUntilRound } — blocks wins for 4-6 rounds after a win
    manualQueue: [],             // FIFO queue of admin-set crash multipliers (used before any auto/random logic)
    cumPool: 0,                  // cumulative pool across all rounds (for house-edge ledger)
    cumPaid: 0,                  // cumulative payouts across all rounds
  };
}
const aviatorState = {
  dollar: makeAviatorPool(),
  star: makeAviatorPool(),
};

async function getAviatorProfitPercent() {
  try {
    const doc = await Setting.findOne({ key: "aviatorProfitPercent" });
    const v = doc && typeof doc.value === "number" ? doc.value : 50;
    return Math.max(0, Math.min(95, v));
  } catch {
    return 50;
  }
}

// Pick a varied crash multiplier — biased low (1.2-1.99x mostly) with occasional 2-3x and rare big wins.
// Pattern user wants: mostly small wins so users feel hopeful, occasional 2-3x, rare bigger.
function randomCrashPoint() {
  const r = Math.random();
  if (r < 0.55) return Number((1.20 + Math.random() * 0.79).toFixed(2)); // 55% → 1.20–1.99x
  if (r < 0.80) return Number((2.00 + Math.random() * 0.99).toFixed(2)); // 25% → 2.00–2.99x
  if (r < 0.93) return Number((3.00 + Math.random() * 1.49).toFixed(2)); // 13% → 3.00–4.49x
  if (r < 0.98) return Number((4.50 + Math.random() * 2.50).toFixed(2)); // 5%  → 4.50–7.00x
  return Number((7.0 + Math.random() * 8.0).toFixed(2));                 // 2%  → 7–15x
}

async function aviatorPhaseTick(currency) {
  const s = aviatorState[currency];
  const now = Date.now();

  if (s.phase === "betting") {
    if (now - s.phaseStartTime >= AVIATOR_PHASE.betting) {
      // Start flying
      s.phase = "flying";
      s.flightStartTime = now;
      s.phaseStartTime = now;
      // Profit% applies to CUMULATIVE pool (long-term house edge).
      const profitPct = await getAviatorProfitPercent();
      s.profitPct = profitPct;
      s.cumPool = (s.cumPool || 0) + s.totalPool;
      // Initial pick from varied pattern (1.2x–15x distribution)
      s.crashAt = randomCrashPoint();
      s.manualOverride = false;

      // Admin manual override: if queue non-empty, dequeue and use that crash point.
      if (Array.isArray(s.manualQueue) && s.manualQueue.length > 0) {
        const next = Number(s.manualQueue.shift());
        if (!isNaN(next) && next >= 1.0) {
          s.crashAt = Number(next.toFixed(2));
          s.manualOverride = true;
        }
      }

      if (!s.manualOverride) {
        // Cumulative ledger: house must keep >= profitPct of cumulative pool over time.
        const targetHouse = s.cumPool * (profitPct / 100);
        const currentHouse = s.cumPool - (s.cumPaid || 0);
        const slack = currentHouse - targetHouse; // <0 = house behind target

        let maxBet = 0;
        for (const k of Object.keys(s.bets)) {
          if (s.bets[k].amount > maxBet) maxBet = s.bets[k].amount;
        }
        if (maxBet > 0 && slack < 0) {
          // House behind → cap projected loss to half the deficit
          const allowedLoss = Math.max(0, Math.abs(slack) * 0.5);
          const safeMult = 1.0 + allowedLoss / maxBet;
          if (safeMult < s.crashAt) s.crashAt = Math.max(1.0, Number(safeMult.toFixed(2)));
        }
      }
    }
  } else if (s.phase === "flying") {
    const elapsed = now - s.flightStartTime;
    const m = aviatorMultiplierAt(elapsed);

    // Dynamic house-edge cap (skipped when admin manual override is active).
    // Uses CUMULATIVE budget so individual rounds are allowed to lose if house is ahead overall.
    if (!s.manualOverride) {
      const cumBudget = (s.cumPool || 0) * (1 - (s.profitPct || 50) / 100);
      const remainingBudget = Math.max(0, cumBudget - (s.cumPaid || 0));
      let maxRemainingBet = 0;
      for (const k of Object.keys(s.bets)) {
        const b = s.bets[k];
        if (!b.cashedOutAt && b.amount > maxRemainingBet) maxRemainingBet = b.amount;
      }
      // Only tighten if even one cashout at current crashAt would bust cumulative budget.
      if (maxRemainingBet > 0 && maxRemainingBet * s.crashAt > remainingBudget) {
        const dynCap = Math.max(1.0, remainingBudget / maxRemainingBet);
        if (dynCap < s.crashAt) s.crashAt = Number(dynCap.toFixed(2));
      }
    }

    if (m >= s.crashAt || elapsed >= AVIATOR_PHASE.flying) {
      // Crash now
      const finalCrash = Math.min(m, s.crashAt);
      s.phase = "crashed";
      s.phaseStartTime = now;
      s.crashAt = Number(finalCrash.toFixed(2));
      s.history = [s.crashAt, ...s.history].slice(0, 18);

      // Persist losing bets as bet transactions; winners already got 'win' tx on cashout
      try {
        for (const key of Object.keys(s.bets)) {
          const b = s.bets[key];
          const tgId = b.userId || Number(String(key).split(":")[0]);
          if (b.amount > 0) {
            await Transaction.create({
              telegramId: Number(tgId),
              type: "bet",
              currency,
              amount: -b.amount,
              status: "completed",
              description: `aviator: Bet ${b.amount} (Round ${s.roundNumber})`,
              game: "aviator",
            });
          }
        }
      } catch (err) { console.error("Aviator bet log error:", err); }
    }
  } else if (s.phase === "crashed") {
    if (now - s.phaseStartTime >= AVIATOR_PHASE.crashed) {
      s.roundNumber++;
      s.phase = "betting";
      s.phaseStartTime = now;
      s.bets = {};
      s.totalPool = 0;
      s.totalPaidOut = 0;
      s.maxPayout = 0;
      s.crashAt = 1.0;
      s.flightStartTime = 0;
    }
  }
}

setInterval(() => {
  aviatorPhaseTick("dollar").catch(() => {});
  aviatorPhaseTick("star").catch(() => {});
}, 200);

// GET /api/aviator/state?currency=dollar|star
app.get("/api/aviator/state", (req, res) => {
  const currency = req.query.currency === "star" ? "star" : "dollar";
  const s = aviatorState[currency];
  const now = Date.now();
  let multiplier = 1;
  let timeLeft = 0;
  if (s.phase === "betting") {
    timeLeft = Math.max(0, Math.ceil((AVIATOR_PHASE.betting - (now - s.phaseStartTime)) / 1000));
  } else if (s.phase === "flying") {
    multiplier = aviatorMultiplierAt(now - s.flightStartTime);
  } else if (s.phase === "crashed") {
    multiplier = s.crashAt;
  }

  // Public bets list (limited)
  const betsList = Object.entries(s.bets).slice(0, 30).map(([tgId, b]) => ({
    user: (b.firstName || "Player").slice(0, 1) + "***" + String(tgId).split(":")[0].slice(-2),
    amount: b.amount,
    multiplier: b.cashedOutAt || null,
    cashout: b.cashedOutAt ? Number((b.amount * b.cashedOutAt).toFixed(2)) : null,
  }));

  res.json({
    roundNumber: s.roundNumber,
    phase: s.phase,
    multiplier: Number(multiplier.toFixed(2)),
    crashAt: s.phase === "crashed" ? s.crashAt : null,
    timeLeft,
    bets: betsList,
    totalPlayers: Object.keys(s.bets).length,
    history: s.history,
  });
});

// POST /api/aviator/bet
app.post("/api/aviator/bet", async (req, res) => {
  try {
    const { userId, amount, currency, firstName, slot } = req.body;
    const curr = currency === "star" ? "star" : "dollar";
    const s = aviatorState[curr];
    if (s.phase !== "betting") return res.status(400).json({ error: "Betting closed for this round" });
    const numAmt = Number(amount);
    if (!numAmt || numAmt <= 0) return res.status(400).json({ error: "Invalid amount" });

    const user = await getOrCreateUser(userId);
    const balField = curr === "dollar" ? "dollarBalance" : "starBalance";
    const winField = curr === "dollar" ? "dollarWinning" : "starWinning";
    const wallet = user[balField] || 0;
    const winning = user[winField] || 0;
    if (wallet + winning < numAmt) return res.status(400).json({ error: "Insufficient balance" });

    const slotNum = slot === 2 ? 2 : 1;
    const key = `${user.telegramId}:${slotNum}`;
    if (s.bets[key]) return res.status(400).json({ error: `Slot ${slotNum} already has a bet this round` });

    const fromWallet = Math.min(wallet, numAmt);
    const fromWin = numAmt - fromWallet;
    user[balField] = wallet - fromWallet;
    user[winField] = winning - fromWin;
    await user.save();

    s.bets[key] = {
      userId: user.telegramId,
      slot: slotNum,
      amount: numAmt,
      firstName: firstName || user.firstName || "Player",
      cashedOutAt: null,
      winAmount: 0,
    };
    s.totalPool += numAmt;

    res.json({ success: true, roundNumber: s.roundNumber, slot: slotNum });
  } catch (err) {
    console.error("Aviator bet error:", err);
    res.status(500).json({ error: "Failed to place bet" });
  }
});

// POST /api/aviator/cancel — refund bet only during betting phase
app.post("/api/aviator/cancel", async (req, res) => {
  try {
    const { userId, currency, slot } = req.body;
    const curr = currency === "star" ? "star" : "dollar";
    const s = aviatorState[curr];
    if (s.phase !== "betting") return res.status(400).json({ error: "Cannot cancel — round already started" });
    const slotNum = slot === 2 ? 2 : 1;
    const user = await getOrCreateUser(userId);
    const key = `${user.telegramId}:${slotNum}`;
    const bet = s.bets[key];
    if (!bet) return res.status(400).json({ error: "No bet to cancel" });

    const balField = curr === "dollar" ? "dollarBalance" : "starBalance";
    user[balField] = (user[balField] || 0) + bet.amount;
    await user.save();

    s.totalPool = Math.max(0, s.totalPool - bet.amount);
    delete s.bets[key];

    res.json({ success: true, refunded: bet.amount });
  } catch (err) {
    console.error("Aviator cancel error:", err);
    res.status(500).json({ error: "Failed to cancel bet" });
  }
});

// POST /api/aviator/cashout
app.post("/api/aviator/cashout", async (req, res) => {
  try {
    const { userId, currency, slot } = req.body;
    const curr = currency === "star" ? "star" : "dollar";
    const s = aviatorState[curr];
    if (s.phase !== "flying") return res.status(400).json({ error: "Cannot cash out now" });

    const numericId = Number(userId);
    const slotNum = slot === 2 ? 2 : 1;
    const key = `${numericId}:${slotNum}`;
    const bet = s.bets[key];
    if (!bet) return res.status(400).json({ error: "No active bet" });
    if (bet.cashedOutAt) return res.status(400).json({ error: "Already cashed out" });

    // NOTE: cooldown force-crash removed — if user taps cashout while phase is "flying",
    // they always succeed. Rigging is still enforced via cumulative-budget crashAt capping below.

    const elapsed = Date.now() - s.flightStartTime;
    const mult = Math.min(aviatorMultiplierAt(elapsed), s.crashAt);
    const win = Number((bet.amount * mult).toFixed(2));

    bet.cashedOutAt = Number(mult.toFixed(2));
    bet.winAmount = win;
    s.totalPaidOut += win;
    s.cumPaid = (s.cumPaid || 0) + win;

    // Set cooldown: next 4-6 rounds this user can't win
    const cd = 4 + Math.floor(Math.random() * 3);
    s.userCooldown[numericId] = s.roundNumber + cd;

    // Credit winning balance immediately + create win tx
    const user = await getOrCreateUser(numericId);
    const winField = curr === "dollar" ? "dollarWinning" : "starWinning";
    user[winField] = (user[winField] || 0) + win;
    await user.save();
    await Transaction.create({
      telegramId: numericId,
      type: "win",
      currency: curr,
      amount: win,
      status: "completed",
      description: `aviator: Won ${win} @ ${bet.cashedOutAt}x (Round ${s.roundNumber})`,
      game: "aviator",
    });

    // House-edge enforcement against CUMULATIVE budget. Skipped when manual override is active.
    if (!s.manualOverride) {
      const profitPct = s.profitPct || (await getAviatorProfitPercent());
      const cumBudget = (s.cumPool || 0) * (1 - profitPct / 100);
      const remainingBudget = cumBudget - (s.cumPaid || 0);
      if (remainingBudget <= 0) {
        // Cumulative budget exhausted → crash now
        s.crashAt = Number(mult.toFixed(2));
      } else {
        const remainingBetSum = Object.values(s.bets).filter((b) => !b.cashedOutAt).reduce((a, b) => a + b.amount, 0);
        if (remainingBetSum > 0 && remainingBetSum * s.crashAt > remainingBudget) {
          const targetMult = remainingBudget / remainingBetSum;
          const safeTarget = Math.max(1.01, Math.min(s.crashAt, Number(targetMult.toFixed(2))));
          if (safeTarget < s.crashAt) s.crashAt = safeTarget;
        }
      }
    }

    res.json({
      success: true,
      multiplier: bet.cashedOutAt,
      winAmount: win,
    });
  } catch (err) {
    console.error("Aviator cashout error:", err);
    res.status(500).json({ error: "Failed to cash out" });
  }
});

// GET /api/aviator/my-bet
app.get("/api/aviator/my-bet", (req, res) => {
  const curr = req.query.currency === "star" ? "star" : "dollar";
  const s = aviatorState[curr];
  const numericId = Number(req.query.userId);
  const slots = [1, 2].map((slot) => {
    const b = s.bets[`${numericId}:${slot}`];
    return b ? { slot, amount: b.amount, cashedOutAt: b.cashedOutAt, winAmount: b.winAmount } : null;
  }).filter(Boolean);
  res.json({
    roundNumber: s.roundNumber,
    phase: s.phase,
    bets: slots,
    bet: slots[0] || null, // backwards compat
  });
});

// GET/POST /api/admin/aviator/profit
app.get("/api/admin/aviator/profit", async (req, res) => {
  if (String(req.query.ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
  const percent = await getAviatorProfitPercent();
  res.json({ percent });
});
app.post("/api/admin/aviator/profit", async (req, res) => {
  try {
    const { ownerId, percent } = req.body;
    if (String(ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
    const num = Number(percent);
    if (isNaN(num) || num < 0 || num > 95) return res.status(400).json({ error: "Percent must be 0-95" });
    await Setting.findOneAndUpdate(
      { key: "aviatorProfitPercent" },
      { key: "aviatorProfitPercent", value: num },
      { upsert: true, new: true }
    );
    res.json({ success: true, percent: num });
  } catch (err) {
    console.error("Set aviator profit error:", err);
    res.status(500).json({ error: "Failed to update" });
  }
});

// ============================================
// Aviator manual crash queue (admin control)
// Admin queues exact crash multipliers per currency. Each round consumes one
// from the head of the queue and uses it as the crash point — bypassing the
// auto profit cap. When the queue is empty, normal profit% logic resumes.
// ============================================
function getAviatorCurr(req) {
  const c = (req.body && req.body.currency) || req.query.currency;
  return c === "star" ? "star" : "dollar";
}

app.get("/api/admin/aviator/manual", (req, res) => {
  if (String(req.query.ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
  const curr = getAviatorCurr(req);
  const s = aviatorState[curr];
  res.json({ currency: curr, queue: s.manualQueue || [], active: !!s.manualOverride, currentCrashAt: s.crashAt });
});

app.post("/api/admin/aviator/manual/add", (req, res) => {
  const { ownerId, value } = req.body || {};
  if (String(ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
  const curr = getAviatorCurr(req);
  const num = Number(value);
  if (isNaN(num) || num <= 0 || num > 100000) return res.status(400).json({ error: "Value must be > 0 and ≤ 100000" });
  const s = aviatorState[curr];
  s.manualQueue = s.manualQueue || [];
  s.manualQueue.push(Number(num.toFixed(2)));
  res.json({ success: true, queue: s.manualQueue });
});

app.post("/api/admin/aviator/manual/set", (req, res) => {
  const { ownerId, queue } = req.body || {};
  if (String(ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
  if (!Array.isArray(queue)) return res.status(400).json({ error: "queue must be an array" });
  const curr = getAviatorCurr(req);
  const cleaned = queue.map((v) => Number(v)).filter((n) => !isNaN(n) && n > 0 && n <= 100000).map((n) => Number(n.toFixed(2)));
  aviatorState[curr].manualQueue = cleaned;
  res.json({ success: true, queue: cleaned });
});

app.post("/api/admin/aviator/manual/clear", (req, res) => {
  const { ownerId } = req.body || {};
  if (String(ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
  const curr = getAviatorCurr(req);
  aviatorState[curr].manualQueue = [];
  res.json({ success: true });
});

app.post("/api/admin/aviator/manual/remove", (req, res) => {
  const { ownerId, index } = req.body || {};
  if (String(ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
  const curr = getAviatorCurr(req);
  const s = aviatorState[curr];
  const i = Number(index);
  if (isNaN(i) || i < 0 || i >= (s.manualQueue || []).length) return res.status(400).json({ error: "Invalid index" });
  s.manualQueue.splice(i, 1);
  res.json({ success: true, queue: s.manualQueue });
});

// GET /api/admin/rigged-high-crash
app.get("/api/admin/rigged-high-crash", async (req, res) => {
  if (String(req.query.ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
  try {
    const doc = await Setting.findOne({ key: "riggedHighCrash" });
    const rigged = doc ? doc.value === true : false;
    res.json({ rigged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/rigged-high-crash
app.post("/api/admin/rigged-high-crash", async (req, res) => {
  try {
    const { ownerId, enabled } = req.body || {};
    if (String(ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
    await Setting.findOneAndUpdate(
      { key: "riggedHighCrash" },
      { key: "riggedHighCrash", value: enabled === true },
      { upsert: true, new: true }
    );
    res.json({ success: true, rigged: enabled === true });
  } catch (err) {
    console.error("Set riggedHighCrash error:", err);
    res.status(500).json({ error: "Failed to update" });
  }
});

// GET /api/game/rig - public endpoint for client gameplay rigging state checks
app.get("/api/game/rig", async (req, res) => {
  try {
    const doc = await Setting.findOne({ key: "riggedHighCrash" });
    res.json({ rigged: doc ? doc.value === true : false });
  } catch (err) {
    res.json({ rigged: false });
  }
});


// ============================================
// OFFERS — Admin manages, public lists
// ============================================

// GET /api/offers — public list of active offers (for Market screen)
app.get("/api/offers", async (req, res) => {
  try {
    const offers = await Offer.find({ active: true }).sort({ createdAt: -1 }).lean();
    res.json({ offers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/offers/list — admin: list all offers
app.post("/api/admin/offers/list", async (req, res) => {
  try {
    const { ownerId } = req.body || {};
    if (String(ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
    const offers = await Offer.find().sort({ createdAt: -1 }).lean();
    res.json({ offers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/offers/create — admin: create new offer
app.post("/api/admin/offers/create", async (req, res) => {
  try {
    const { ownerId, title, payAmount, payCurrency, getAmount, bonusLabel, valueLabel } = req.body || {};
    if (String(ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
    if (!title || !payAmount || !payCurrency || !getAmount) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!["star", "dollar"].includes(payCurrency)) {
      return res.status(400).json({ error: "payCurrency must be star or dollar" });
    }
    const offer = await Offer.create({
      title: String(title),
      payAmount: Number(payAmount),
      payCurrency,
      getAmount: Number(getAmount),
      bonusLabel: bonusLabel || "",
      valueLabel: valueLabel || "",
      active: true,
    });
    res.json({ success: true, offer });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/offers/update — admin: edit an existing offer
app.post("/api/admin/offers/update", async (req, res) => {
  try {
    const { ownerId, offerId, title, payAmount, payCurrency, getAmount, bonusLabel, valueLabel } = req.body || {};
    if (String(ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
    if (!offerId) return res.status(400).json({ error: "Missing offerId" });
    const update = {};
    if (title !== undefined) update.title = String(title);
    if (payAmount !== undefined) update.payAmount = Number(payAmount);
    if (payCurrency !== undefined) {
      if (!["star", "dollar"].includes(payCurrency)) return res.status(400).json({ error: "payCurrency must be star or dollar" });
      update.payCurrency = payCurrency;
    }
    if (getAmount !== undefined) update.getAmount = Number(getAmount);
    if (bonusLabel !== undefined) update.bonusLabel = bonusLabel || "";
    if (valueLabel !== undefined) update.valueLabel = valueLabel || "";
    const offer = await Offer.findByIdAndUpdate(offerId, update, { new: true });
    if (!offer) return res.status(404).json({ error: "Offer not found" });
    res.json({ success: true, offer });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/offers/delete — admin: delete an offer
app.post("/api/admin/offers/delete", async (req, res) => {
  try {
    const { ownerId, offerId } = req.body || {};
    if (String(ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
    if (!offerId) return res.status(400).json({ error: "Missing offerId" });
    await Offer.deleteOne({ _id: offerId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/offers/broadcast — admin: send a single offer to all users via bot
app.post("/api/admin/offers/broadcast", async (req, res) => {
  try {
    const { ownerId, offerId } = req.body || {};
    if (String(ownerId) !== "6965488457") return res.status(403).json({ error: "Unauthorized" });
    if (!offerId) return res.status(400).json({ error: "Missing offerId" });

    const offer = await Offer.findById(offerId).lean();
    if (!offer) return res.status(404).json({ error: "Offer not found" });

    const users = await User.find({}, { telegramId: 1 }).lean();
    const payDisplay = offer.payCurrency === "star" ? `${offer.payAmount} ⭐` : `$${offer.payAmount}`;
    const getDisplay = offer.payCurrency === "star" ? `${offer.getAmount} ⭐` : `$${offer.getAmount}`;
    const text =
      `🎁 <b>${offer.title}</b>\n\n` +
      `💰 Pay: <b>${payDisplay}</b>\n` +
      `🎯 Get: <b>${getDisplay}</b>\n` +
      (offer.bonusLabel ? `✨ Bonus: <b>${offer.bonusLabel}</b>\n` : "") +
      (offer.valueLabel ? `🔥 ${offer.valueLabel}\n` : "") +
      `\nTap below to claim this offer in the Market!`;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [[
          { text: "🛒 Open Market", url: "https://t.me/RoyalKingGameBot/RoyalKingGame?startapp=market" },
        ]],
      },
      parse_mode: "HTML",
    };

    let sent = 0;
    let failed = 0;
    for (const u of users) {
      if (!u.telegramId || u.telegramId === 0) continue;
      try {
        await bot.sendMessage(u.telegramId, text, keyboard);
        sent++;
      } catch (err) {
        failed++;
      }
      // rate-limit a little to avoid Telegram limits
      await new Promise((r) => setTimeout(r, 35));
    }
    res.json({ success: true, sent, failed, total: users.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// TOURNAMENTS
// ============================================
const OWNER_ID_STR = "6965488457";

// Public: list active tournaments
app.get("/api/tournaments/active", async (req, res) => {
  try {
    const list = await Tournament.find({ active: true }).sort({ createdAt: -1 }).lean();
    res.json({ tournaments: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper: compute prize for a given rank from tiers
function prizeForRank(t, rank) {
  if (Array.isArray(t.prizeTiers) && t.prizeTiers.length) {
    const tier = t.prizeTiers.find((tt) => rank >= tt.fromRank && rank <= tt.toRank);
    return tier ? tier.amount : 0;
  }
  return t.prizePerWinner || 0;
}

function effectiveTopN(t) {
  if (Array.isArray(t.prizeTiers) && t.prizeTiers.length) {
    return Math.min(100, t.prizeTiers.reduce((m, tt) => Math.max(m, tt.toRank), 0));
  }
  return t.tier || 50;
}

// Public: leaderboard for a tournament (top N by games played)
app.get("/api/tournaments/:id/leaderboard", async (req, res) => {
  try {
    const t = await Tournament.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ error: "Tournament not found" });

    const match = {
      type: "bet",
      status: "completed",
      createdAt: { $gte: t.startedAt },
    };
    if (t.endsAt) match.createdAt.$lte = t.endsAt;
    if (t.gameFilter) match.game = t.gameFilter;

    const limit = effectiveTopN(t);
    const top = await Transaction.aggregate([
      { $match: match },
      { $group: { _id: "$telegramId", gamesPlayed: { $sum: 1 } } },
      { $sort: { gamesPlayed: -1 } },
      { $limit: limit },
    ]);

    const ids = top.map(x => x._id);
    const users = await User.find({ telegramId: { $in: ids } })
      .select("telegramId firstName username")
      .lean();
    const userMap = {};
    users.forEach(u => { userMap[u.telegramId] = u; });

    const leaderboard = top.map((row, i) => ({
      rank: i + 1,
      telegramId: row._id,
      gamesPlayed: row.gamesPlayed,
      firstName: userMap[row._id]?.firstName || "Player",
      username: userMap[row._id]?.username || "",
      prize: prizeForRank(t, i + 1),
      currency: t.prizeCurrency,
    }));

    res.json({
      tournament: t,
      leaderboard,
      totalPlayers: leaderboard.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: list all tournaments
app.post("/api/admin/tournaments/list", async (req, res) => {
  try {
    if (String(req.body?.ownerId) !== OWNER_ID_STR) return res.status(403).json({ error: "Unauthorized" });
    const list = await Tournament.find().sort({ createdAt: -1 }).lean();
    res.json({ tournaments: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: create tournament
app.post("/api/admin/tournaments/create", async (req, res) => {
  try {
    const { ownerId, title, imageUrl, prizeCurrency, prizeTiers, gameFilter, durationMs } = req.body || {};
    if (String(ownerId) !== OWNER_ID_STR) return res.status(403).json({ error: "Unauthorized" });
    if (!title || !prizeCurrency) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!["star", "dollar"].includes(prizeCurrency)) {
      return res.status(400).json({ error: "prizeCurrency must be star or dollar" });
    }
    // Validate prize tiers
    const tiers = Array.isArray(prizeTiers) ? prizeTiers : [];
    const cleanTiers = [];
    for (const row of tiers) {
      const f = Number(row.fromRank), to = Number(row.toRank), a = Number(row.amount);
      if (!f || !to || isNaN(a) || f < 1 || to < f || to > 100) {
        return res.status(400).json({ error: `Invalid tier: ${f}-${to}` });
      }
      cleanTiers.push({ fromRank: f, toRank: to, amount: a });
    }
    if (cleanTiers.length === 0) {
      return res.status(400).json({ error: "At least one prize tier required" });
    }
    const topN = cleanTiers.reduce((m, tt) => Math.max(m, tt.toRank), 0);
    const dur = Number(durationMs) || 0;
    const endsAt = dur > 0 ? new Date(Date.now() + dur) : null;

    const t = await Tournament.create({
      title: String(title),
      imageUrl: imageUrl || "",
      prizeCurrency,
      prizeTiers: cleanTiers,
      tier: topN,
      prizePerWinner: 0,
      gameFilter: gameFilter || "",
      endsAt,
      active: true,
    });
    res.json({ success: true, tournament: t });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: delete tournament
app.post("/api/admin/tournaments/delete", async (req, res) => {
  try {
    const { ownerId, tournamentId } = req.body || {};
    if (String(ownerId) !== OWNER_ID_STR) return res.status(403).json({ error: "Unauthorized" });
    if (!tournamentId) return res.status(400).json({ error: "Missing tournamentId" });
    await Tournament.deleteOne({ _id: tournamentId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: distribute prizes to winners (credits prizeCurrency winning balance)
app.post("/api/admin/tournaments/distribute", async (req, res) => {
  try {
    const { ownerId, tournamentId } = req.body || {};
    if (String(ownerId) !== OWNER_ID_STR) return res.status(403).json({ error: "Unauthorized" });
    const t = await Tournament.findById(tournamentId);
    if (!t) return res.status(404).json({ error: "Tournament not found" });

    const match = { type: "bet", status: "completed", createdAt: { $gte: t.startedAt } };
    if (t.endsAt) match.createdAt.$lte = t.endsAt;
    if (t.gameFilter) match.game = t.gameFilter;

    const top = await Transaction.aggregate([
      { $match: match },
      { $group: { _id: "$telegramId", gamesPlayed: { $sum: 1 } } },
      { $sort: { gamesPlayed: -1 } },
      { $limit: effectiveTopN(t) },
    ]);

    const winningField = t.prizeCurrency === "dollar" ? "dollarWinning" : "starWinning";
    let credited = 0;
    for (let i = 0; i < top.length; i++) {
      const row = top[i];
      const rank = i + 1;
      const prize = prizeForRank(t, rank);
      if (!prize) continue;
      const u = await User.findOne({ telegramId: row._id });
      if (!u) continue;
      u[winningField] = (u[winningField] || 0) + prize;
      await u.save();
      await Transaction.create({
        telegramId: row._id,
        type: "bonus",
        currency: t.prizeCurrency,
        amount: prize,
        status: "completed",
        description: `Tournament prize (rank #${rank}): ${t.title}`,
      });
      credited++;
    }
    t.active = false;
    await t.save();
    res.json({ success: true, credited });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// JETX MULTIPLAYER (PHP-EXACT rigging, per-currency pools)
// Ported from raja-aviator.cloud server.js:
//   - Betting window 5s
//   - When flying starts, sum pending bets:
//       total == 0   → finalCrash = randInt(2..7),   tick 200ms
//       total <= 100 → finalCrash = 1.00 + rand*0.50, tick 300ms
//       total  > 100 → finalCrash = 1.00 + rand*0.50, tick 200ms
//   - Multiplier starts at 0.99 and +0.01 every tick until >= finalCrash
//   - Payout on cashout = amount * 0.98 * currentMultiplier
//   - Crashed phase 4s (3s show + 1s reset gap) then new round
// ============================================
const JETX_BETTING_MS = 5000;
// PHP: after crash, 200ms fail pending → 3s wait → removecrash → 4s wait → prepareplane+flyplane → 1s → setcrash
const JETX_CRASHED_MS = 8000;
const JETX_HISTORY_LEN = 18;

function makeJetxPool() {
  return {
    roundNumber: 1,
    phase: "betting",              // "betting" | "flying" | "crashed"
    phaseStartTime: Date.now(),
    finalCrash: 1,
    crashPosition: 0.99,
    tickIntervalMs: 200,
    flyTimer: null,
    bets: {},                      // { telegramId: { amount, firstName, cashedOutAt, winAmount } }
    totalPool: 0,
    history: [],
  };
}
const jetxState = {
  dollar: makeJetxPool(),
  star: makeJetxPool(),
};

function jetxComputeCrash(pool) {
  const total = pool.totalPool;
  if (total === 0) {
    pool.finalCrash = Math.floor(Math.random() * 6) + 2;         // 2..7
    pool.tickIntervalMs = 200;
  } else if (total <= 100) {
    pool.finalCrash = Number((Math.random() * 0.5 + 1).toFixed(2));
    pool.tickIntervalMs = 300;
  } else {
    pool.finalCrash = Number((Math.random() * 0.5 + 1).toFixed(2));
    pool.tickIntervalMs = 200;
  }
}

async function jetxStartFlying(currency) {
  const s = jetxState[currency];
  s.phase = "flying";
  s.phaseStartTime = Date.now();
  s.crashPosition = 0.99;
  jetxComputeCrash(s);

  if (s.flyTimer) clearInterval(s.flyTimer);
  s.flyTimer = setInterval(() => {
    const fc = parseFloat(s.finalCrash);
    const cp = parseFloat(s.crashPosition);
    if (fc > cp) {
      s.crashPosition = Number((cp + 0.01).toFixed(2));
    } else {
      clearInterval(s.flyTimer);
      s.flyTimer = null;
      jetxOnCrash(currency).catch((e) => console.error("JetX crash error:", e));
    }
  }, s.tickIntervalMs);
}

async function jetxOnCrash(currency) {
  const s = jetxState[currency];
  s.phase = "crashed";
  s.phaseStartTime = Date.now();
  s.history = [Number(s.crashPosition), ...s.history].slice(0, JETX_HISTORY_LEN);

  // Persist losing bets (winners already got their 'win' tx on cashout)
  try {
    for (const key of Object.keys(s.bets)) {
      const b = s.bets[key];
      if (b.amount > 0 && !b.cashedOutAt) {
        await Transaction.create({
          telegramId: Number(key),
          type: "bet",
          currency,
          amount: -b.amount,
          status: "completed",
          description: `jetx: Bet ${b.amount} lost @ ${s.crashPosition}x (Round ${s.roundNumber})`,
          game: "jetx",
        });
      }
    }
  } catch (err) { console.error("JetX bet log error:", err); }
}

function jetxResetRound(currency) {
  const s = jetxState[currency];
  s.roundNumber++;
  s.phase = "betting";
  s.phaseStartTime = Date.now();
  s.bets = {};
  s.totalPool = 0;
  s.crashPosition = 0.99;
  s.finalCrash = 1;
}

function jetxSupervisor(currency) {
  const s = jetxState[currency];
  const now = Date.now();
  if (s.phase === "betting" && now - s.phaseStartTime >= JETX_BETTING_MS) {
    jetxStartFlying(currency).catch((e) => console.error("JetX fly start:", e));
  } else if (s.phase === "crashed" && now - s.phaseStartTime >= JETX_CRASHED_MS) {
    jetxResetRound(currency);
  }
}
setInterval(() => { jetxSupervisor("dollar"); jetxSupervisor("star"); }, 250);

// GET /api/jetx/state?currency=dollar|star
app.get("/api/jetx/state", (req, res) => {
  const currency = req.query.currency === "star" ? "star" : "dollar";
  const s = jetxState[currency];
  const now = Date.now();
  let multiplier = 1;
  let timeLeft = 0;
  if (s.phase === "betting") {
    timeLeft = Math.max(0, Math.ceil((JETX_BETTING_MS - (now - s.phaseStartTime)) / 1000));
  } else if (s.phase === "flying") {
    multiplier = Number(s.crashPosition);
  } else if (s.phase === "crashed") {
    multiplier = Number(s.crashPosition);
  }
  const betsList = Object.entries(s.bets).slice(0, 30).map(([tgId, b]) => ({
    user: (b.firstName || "Player").slice(0, 1) + "***" + String(tgId).slice(-2),
    amount: b.amount,
    multiplier: b.cashedOutAt || null,
    cashout: b.cashedOutAt ? Number((b.amount * 0.98 * b.cashedOutAt).toFixed(2)) : null,
  }));
  res.json({
    roundNumber: s.roundNumber,
    phase: s.phase,
    multiplier: Number(multiplier.toFixed(2)),
    crashAt: s.phase === "crashed" ? Number(s.crashPosition) : null,
    timeLeft,
    bets: betsList,
    totalPlayers: Object.keys(s.bets).length,
    history: s.history,
  });
});

// POST /api/jetx/bet
app.post("/api/jetx/bet", async (req, res) => {
  try {
    const { userId, amount, currency, firstName } = req.body;
    const curr = currency === "star" ? "star" : "dollar";
    const s = jetxState[curr];
    if (s.phase !== "betting") return res.status(400).json({ error: "Betting closed for this round" });
    const numAmt = Number(amount);
    if (!numAmt || numAmt <= 0) return res.status(400).json({ error: "Invalid amount" });

    const user = await getOrCreateUser(userId);
    const balField = curr === "dollar" ? "dollarBalance" : "starBalance";
    const winField = curr === "dollar" ? "dollarWinning" : "starWinning";
    const wallet = user[balField] || 0;
    const winning = user[winField] || 0;
    if (wallet + winning < numAmt) return res.status(400).json({ error: "Insufficient balance" });

    const key = String(user.telegramId);
    if (s.bets[key]) return res.status(400).json({ error: "You already have a bet this round" });

    const fromWallet = Math.min(wallet, numAmt);
    const fromWin = numAmt - fromWallet;
    user[balField] = wallet - fromWallet;
    user[winField] = winning - fromWin;
    await user.save();

    s.bets[key] = {
      amount: numAmt,
      firstName: firstName || user.firstName || "Player",
      cashedOutAt: null,
      winAmount: 0,
    };
    s.totalPool += numAmt;

    res.json({ success: true, roundNumber: s.roundNumber });
  } catch (err) {
    console.error("JetX bet error:", err);
    res.status(500).json({ error: "Failed to place bet" });
  }
});

// POST /api/jetx/cashout
app.post("/api/jetx/cashout", async (req, res) => {
  try {
    const { userId, currency } = req.body;
    const curr = currency === "star" ? "star" : "dollar";
    const s = jetxState[curr];
    if (s.phase !== "flying") return res.status(400).json({ error: "Cannot cash out now" });

    const numericId = Number(userId);
    const key = String(numericId);
    const bet = s.bets[key];
    if (!bet) return res.status(400).json({ error: "No active bet" });
    if (bet.cashedOutAt) return res.status(400).json({ error: "Already cashed out" });

    const mult = Number(s.crashPosition);
    // PHP-exact payout: winamount = amount * 98/100 * winpoint
    const win = Number((bet.amount * 0.98 * mult).toFixed(2));
    bet.cashedOutAt = mult;
    bet.winAmount = win;

    const user = await getOrCreateUser(numericId);
    const winField = curr === "dollar" ? "dollarWinning" : "starWinning";
    user[winField] = (user[winField] || 0) + win;
    await user.save();
    await Transaction.create({
      telegramId: numericId,
      type: "win",
      currency: curr,
      amount: win,
      status: "completed",
      description: `jetx: Won ${win} @ ${mult}x (Round ${s.roundNumber})`,
      game: "jetx",
    });

    res.json({ success: true, multiplier: mult, winAmount: win });
  } catch (err) {
    console.error("JetX cashout error:", err);
    res.status(500).json({ error: "Failed to cash out" });
  }
});

// GET /api/jetx/my-bet?userId=&currency=
app.get("/api/jetx/my-bet", (req, res) => {
  const curr = req.query.currency === "star" ? "star" : "dollar";
  const s = jetxState[curr];
  const key = String(Number(req.query.userId));
  const b = s.bets[key];
  res.json({
    roundNumber: s.roundNumber,
    phase: s.phase,
    bet: b ? { amount: b.amount, cashedOutAt: b.cashedOutAt, winAmount: b.winAmount } : null,
  });
});



app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ============================================
// Start server
// ============================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);

  // Set Telegram webhook automatically
  const KOYEB_URL = process.env.KOYEB_URL || "https://broken-bria-chetan1-ea890b93.koyeb.app";
  bot.setWebHook(`${KOYEB_URL}/api/telegram-webhook`)
    .then(() => console.log("✅ Webhook set successfully"))
    .catch((err) => console.error("❌ Webhook error:", err));
});
