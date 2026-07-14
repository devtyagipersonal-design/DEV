import { motion, AnimatePresence } from "framer-motion";
import { X, Copy } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getTelegram, requestInvoice } from "@/lib/telegram";
import { useBalanceContext } from "@/contexts/BalanceContext";
import { useEffect, useState } from "react";
import OfferCard3D from "@/components/OfferCard3D";

interface MarketScreenProps {
  onGoToWallet?: () => void;
}

interface BackendOffer {
  _id: string;
  title: string;
  payAmount: number;
  payCurrency: "star" | "dollar";
  getAmount: number;
  bonusLabel?: string;
  valueLabel?: string;
}

const apiBase = import.meta.env.VITE_API_BASE_URL || "https://broken-bria-chetan1-ea890b93.koyeb.app/api";

const cryptoApiTicker: Record<string, string> = { usdt: "usdttrc20" };
const CRYPTO_OPTIONS: Array<{ id: string; label: string; emoji: string }> = [
  { id: "btc", label: "BTC", emoji: "₿" },
  { id: "ltc", label: "LTC", emoji: "Ł" },
  { id: "usdt", label: "USDT", emoji: "₮" },
  { id: "ton", label: "TON", emoji: "💎" },
  { id: "sol", label: "SOL", emoji: "◎" },
  { id: "trx", label: "TRX", emoji: "🔺" },
  { id: "doge", label: "DOGE", emoji: "🐕" },
];

const gradientFor = (idx: number) => {
  const list = [
    "linear-gradient(135deg, hsl(280 75% 45%), hsl(310 70% 40%))",
    "linear-gradient(135deg, hsl(140 65% 38%), hsl(170 60% 35%))",
    "linear-gradient(135deg, hsl(25 90% 45%), hsl(45 95% 45%))",
    "linear-gradient(135deg, hsl(200 75% 45%), hsl(220 70% 40%))",
  ];
  return list[idx % list.length];
};
const badgeFor = (idx: number) => {
  const list = [
    "linear-gradient(135deg, hsl(45 95% 55%), hsl(35 90% 50%))",
    "linear-gradient(135deg, hsl(0 80% 55%), hsl(15 80% 50%))",
    "linear-gradient(135deg, hsl(280 70% 55%), hsl(310 65% 50%))",
    "linear-gradient(135deg, hsl(140 70% 45%), hsl(170 60% 40%))",
  ];
  return list[idx % list.length];
};

const MarketScreen = ({ onGoToWallet }: MarketScreenProps) => {
  const { refreshBalance } = useBalanceContext();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [offers, setOffers] = useState<BackendOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [coinPickerOffer, setCoinPickerOffer] = useState<BackendOffer | null>(null);
  const [cryptoPayment, setCryptoPayment] = useState<{
    payAddress: string;
    payAmount: number;
    payCurrency: string;
    orderId: string;
    offerLabel: string;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${apiBase}/offers`);
        const d = await r.json();
        setOffers(d.offers || []);
      } catch {
        setOffers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const claimStarOffer = async (offer: BackendOffer) => {
    setBusyId(offer._id);
    try {
      const tg = getTelegram();
      if (!tg) {
        throw new Error("Please open this app inside Telegram to make payments.");
      }
      const invoiceUrl = await requestInvoice("deposit", "star", offer.payAmount);
      // Clear busy immediately so the button is responsive while invoice is open
      setBusyId(null);
      tg.openInvoice(invoiceUrl, (status) => {
        if (status === "paid") {
          toast({ title: "Offer paid! 🎁", description: `${offer.bonusLabel || "Bonus"} will be credited by admin shortly.` });
          refreshBalance();
        } else if (status === "cancelled") {
          toast({ title: "Cancelled", description: "Offer payment cancelled." });
        } else if (status === "failed") {
          toast({ title: "Payment failed", description: "Please try again.", variant: "destructive" });
        }
      });
    } catch (err: any) {
      setBusyId(null);
      toast({ title: "Error", description: err?.message || "Could not start payment.", variant: "destructive" });
    }
  };

  const claimDollarOffer = (offer: BackendOffer) => {
    // Open coin picker first — user picks BTC/LTC/USDT/etc., then we create payment directly
    setCoinPickerOffer(offer);
  };

  const startCryptoPayment = async (offer: BackendOffer, coinId: string) => {
    setBusyId(offer._id);
    setCoinPickerOffer(null);
    try {
      const tg = getTelegram();
      const userId = tg?.initDataUnsafe?.user?.id || "demo";
      const apiCurrency = cryptoApiTicker[coinId] || coinId;
      const res = await fetch(`${apiBase}/crypto/create-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, amount: offer.payAmount, currency: apiCurrency }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create payment");
      if (!data.payAddress) throw new Error("No payment address returned");
      setCryptoPayment({
        payAddress: data.payAddress,
        payAmount: data.payAmount,
        payCurrency: data.payCurrency,
        orderId: data.orderId,
        offerLabel: `${offer.title} • Get $${offer.getAmount}`,
      });
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Could not start offer.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const claim = (offer: BackendOffer) =>
    offer.payCurrency === "star" ? claimStarOffer(offer) : claimDollarOffer(offer);

  return (
    <div className="relative z-10 px-4 pt-4 pb-24 space-y-4 bg-[#0b0e14] text-slate-100 min-h-screen">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-3.5 flex items-center gap-3 bg-[#1c2230] border border-white/[0.04] shadow-md"
      >
        <span className="text-2xl">🏪</span>
        <div>
          <h2 className="font-bold text-xs text-white">Market — Special Offers</h2>
          <p className="text-[10px] text-slate-400 mt-0.5">Purchase star packages and cash balance bundles</p>
        </div>
      </motion.div>

      {loading ? (
        <p className="text-center text-xs py-8 text-slate-400">Loading offers…</p>
      ) : offers.length === 0 ? (
        <div className="rounded-2xl p-6 text-center bg-[#1c2230] border border-dashed border-white/[0.04]">
          <div className="text-3xl mb-1.5">📭</div>
          <p className="text-xs font-bold text-white">No active offers right now</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Check back soon for special deals!</p>
        </div>
      ) : (
        offers.map((offer, idx) => (
          <motion.div
            key={offer._id}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
          >
            <OfferCard3D
              offer={offer}
              onClaim={() => claim(offer)}
              busy={busyId === offer._id}
            />
          </motion.div>
        ))
      )}

      {offers.length > 0 && (
        <p className="text-center text-[9px] text-slate-500 px-4">
          After payment, bonus will be credited automatically by admin.
        </p>
      )}

      <AnimatePresence>
        {coinPickerOffer && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ background: "rgba(0, 0, 0, 0.6)" }}
            onClick={() => setCoinPickerOffer(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl p-4 max-h-[80vh] overflow-y-auto bg-[#1c2230] border border-white/[0.04] shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm text-white">Pay ${coinPickerOffer.payAmount} with…</h3>
                <button onClick={() => setCoinPickerOffer(null)}>
                  <X className="h-4 w-4 text-slate-400" />
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mb-3">
                Select a cryptocurrency. Bonus: {coinPickerOffer.bonusLabel || `Get $${coinPickerOffer.getAmount}`}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {CRYPTO_OPTIONS.map((c) => (
                  <motion.button
                    key={c.id}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => startCryptoPayment(coinPickerOffer, c.id)}
                    className="rounded-xl py-2.5 font-bold flex flex-col items-center gap-1 bg-[#131924] border border-white/[0.04] hover:bg-slate-800 transition-colors"
                  >
                    <span className="text-xl">{c.emoji}</span>
                    <span className="text-[10px] text-slate-300">{c.label}</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cryptoPayment && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setCryptoPayment(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl p-4 max-h-[80vh] overflow-y-auto bg-[#1c2230] border border-white/[0.04] shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm text-white">Send Payment</h3>
                <button onClick={() => setCryptoPayment(null)}>
                  <X className="h-4 w-4 text-slate-400" />
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mb-3">{cryptoPayment.offerLabel}</p>

              <div className="rounded-xl p-3.5 mb-3 bg-[#131924] border border-white/[0.04]">
                <p className="text-[9px] text-slate-400 mb-0.5">Send exactly</p>
                <p className="font-bold text-base text-amber-400">
                  {cryptoPayment.payAmount} {cryptoPayment.payCurrency.toUpperCase()}
                </p>
              </div>

              <div className="rounded-xl p-3.5 mb-3 bg-[#131924] border border-white/[0.04]">
                <p className="text-[9px] text-slate-400 mb-0.5">{cryptoPayment.payCurrency.toUpperCase()} Address</p>
                <p className="text-[10px] font-mono break-all select-all text-white">{cryptoPayment.payAddress}</p>
              </div>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(cryptoPayment.payAddress);
                  toast({ title: "Copied!", description: "Address copied to clipboard." });
                }}
                className="w-full rounded-xl py-2.5 font-bold flex items-center justify-center gap-1.5 bg-[#3b82f6] hover:bg-blue-600 text-white border border-blue-500/20 active:scale-98 transition-transform"
              >
                <Copy className="h-4 w-4" /> Copy Address
              </button>
              <p className="text-[9px] text-center text-slate-400 mt-2.5">
                Bonus automatically credited after blockchain confirmation.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MarketScreen;
