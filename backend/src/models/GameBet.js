const mongoose = require("mongoose");

const gameBetSchema = new mongoose.Schema(
  {
    roundNumber: {
      type: Number,
      required: true,
      index: true,
    },
    telegramId: {
      type: Number,
      required: true,
    },
    firstName: {
      type: String,
      default: "Player",
    },
    fruitIndex: {
      type: Number,
      required: true,
      min: 0,
      max: 7,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    currency: {
      type: String,
      enum: ["dollar", "star"],
      required: true,
    },
  },
  { timestamps: true }
);

// Compound index for fast lookups
gameBetSchema.index({ roundNumber: 1, telegramId: 1 });
gameBetSchema.index({ roundNumber: 1, currency: 1 });

module.exports = mongoose.model("GameBet", gameBetSchema);
