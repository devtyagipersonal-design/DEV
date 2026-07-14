const mongoose = require("mongoose");

const OfferSchema = new mongoose.Schema({
  title: { type: String, required: true },
  // What user pays
  payAmount: { type: Number, required: true },
  payCurrency: { type: String, enum: ["star", "dollar"], required: true }, // star = Telegram Stars; dollar = USD via crypto
  // What user gets (display only — actual credit handled via existing deposit + manual bonus)
  getAmount: { type: Number, required: true },
  bonusLabel: { type: String, default: "" }, // e.g. "+100 ⭐" or "+$10 bonus"
  valueLabel: { type: String, default: "" }, // e.g. "120% VALUE"
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Offer", OfferSchema);
