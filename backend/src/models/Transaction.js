const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    telegramId: {
      type: Number,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["deposit", "withdraw", "bet", "win", "bonus", "convert", "ton_deposit", "ton_withdraw", "referral"],
      required: true,
    },
    currency: {
      type: String,
      enum: ["dollar", "star", "ton"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
    },
    telegramPaymentId: String,
    description: String,
    game: String,
    // TON-specific fields
    tonTxHash: String,
    tonAmount: Number, // in TON (not nanoTON)
    tonSenderAddress: String,
    tonReceiverAddress: String,
    depositComment: String,
    usdEquivalent: Number,
    // Withdrawal-specific fields
    cryptoAddress: String,
    withdrawalNetwork: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", transactionSchema);
