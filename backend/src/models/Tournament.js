const mongoose = require("mongoose");

const PrizeTierSchema = new mongoose.Schema({
  fromRank: { type: Number, required: true, min: 1 },
  toRank: { type: Number, required: true, min: 1 },
  amount: { type: Number, required: true, min: 0 },
}, { _id: false });

const TournamentSchema = new mongoose.Schema({
  title: { type: String, required: true },
  imageUrl: { type: String, default: "" }, // can be URL or base64 data URL
  prizeCurrency: { type: String, enum: ["dollar", "star"], required: true },
  // Custom prize tiers — e.g. [{1,1,1000},{2,2,500},{3,3,250},{4,20,50},{21,50,20},{51,100,10}]
  prizeTiers: { type: [PrizeTierSchema], default: [] },
  // Legacy/fallback: total winners awarded (kept for backwards compat)
  tier: { type: Number, default: 50 },
  // Legacy single prize fallback (used when prizeTiers is empty)
  prizePerWinner: { type: Number, default: 0 },
  gameFilter: { type: String, default: "" },
  startedAt: { type: Date, default: Date.now },
  endsAt: { type: Date, default: null },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Tournament", TournamentSchema);
