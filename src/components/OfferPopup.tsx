import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getTelegram, requestInvoice } from "@/lib/telegram";
import { useBalanceContext } from "@/contexts/BalanceContext";
import OfferCard3D, { OfferCard3DData } from "@/components/OfferCard3D";

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

interface BackendOffer extends OfferCard3DData {
  title?: string;
}

const OfferPopup = () => {
  const { refreshBalance } = useBalanceContext();
  const [offer, setOffer] = useState<BackendOffer | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [coinPickerOpen, setCoinPickerOpen] = useState(false);
  const [cryptoPayment, setCryptoPayment] = useState<{
    payAddress: string; payAmount: number; payCurrency: string; orderId: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${apiBase}/offers`);
        const d = await r.json();
        const first = (d.offers || [])[0];
        if (!cancelled && first) {
          setOffer(first);
          // Small delay so it doesn't clash with splash
          setTimeout(() => !cancelled && setOpen(true), 600);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!offer) return null;

  const close = () => setOpen(false);

  const claim = async () => {
    if (!offer) return;
    if (offer.payCurrency === "star") {
      setBusy(true);
      try {
        const tg = getTelegram();
        if (!tg) throw new Error("Please open this app inside Telegram to make payments.");
        const invoiceUrl = await requestInvoice("deposit", "star", offer.payAmount);
        setBusy(false);
        tg.openInvoice(invoiceUrl, (status) => {
          if (status === "paid") {
            toast({ title: "Offer paid! 🎁", description: `${offer.bonusLabel || "Bonus"} will be credited shortly.` });
            refreshBalance();
            close();
          } else if (status === "cancelled") {
            toast({ title: "Cancelled", description: "Offer payment cancelled." });
          } else if (status === "failed") {
            toast({ title: "Payment failed", description: "Please try again.", variant: "destructive" });
          }
        });
      } catch (err: any) {
        setBusy(false);
        toast({ title: "Error", description: err?.message || "Could not start payment.", variant: "destructive" });
      }
    } else {
      setCoinPickerOpen(true);
    }
  };

  const startCryptoPayment = async (coinId: string) => {
    if (!offer) return;
    setBusy(true);
    setCoinPickerOpen(false);
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
      });
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Could not start offer.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ background: "hsla(260, 50%, 6%, 0.88)", backdropFilter: "blur(8px)" }}
        >
          <motion.div
            initial={{ scale: 0.85, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 280 }}
            className="w-full max-w-sm relative pt-10"
          >
            <button
              onClick={close}
              aria-label="Close offer"
              className="absolute top-0 right-1 z-20 w-10 h-10 rounded-full flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, hsl(0 85% 55%), hsl(15 85% 48%))",
                boxShadow: "0 4px 12px hsla(0,0%,0%,0.5)",
                border: "3px solid hsl(0 0% 100%)",
              }}
            >
              <X className="h-5 w-5" style={{ color: "hsl(0 0% 100%)" }} />
            </button>
            <OfferCard3D offer={offer} onClaim={claim} busy={busy} />
          </motion.div>

          {/* Coin picker */}
          <AnimatePresence>
            {coinPickerOpen && (
              <motion.div
                className="fixed inset-0 z-[70] flex items-center justify-center p-4"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ background: "hsla(260, 50%, 8%, 0.9)" }}
                onClick={() => setCoinPickerOpen(false)}
              >
                <motion.div
                  initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                  className="w-full max-w-md rounded-2xl p-4"
                  style={{ background: "linear-gradient(180deg, hsl(260 45% 18%), hsl(270 50% 12%))", border: "1px solid hsla(280, 60%, 45%, 0.4)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="font-black text-base mb-3" style={{ color: "hsl(45 95% 70%)" }}>Pay ${offer.payAmount} with…</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {CRYPTO_OPTIONS.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => startCryptoPayment(c.id)}
                        className="rounded-xl py-3 font-black flex flex-col items-center gap-1"
                        style={{
                          background: "linear-gradient(135deg, hsl(280 60% 35%), hsl(300 55% 30%))",
                          border: "1px solid hsla(280, 70%, 50%, 0.5)",
                          color: "hsl(0 0% 100%)",
                        }}
                      >
                        <span className="text-2xl">{c.emoji}</span>
                        <span className="text-xs">{c.label}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Crypto payment */}
          <AnimatePresence>
            {cryptoPayment && (
              <motion.div
                className="fixed inset-0 z-[70] flex items-center justify-center p-4"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ background: "hsla(260, 50%, 8%, 0.92)" }}
                onClick={() => setCryptoPayment(null)}
              >
                <motion.div
                  initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                  className="w-full max-w-md rounded-2xl p-4"
                  style={{ background: "linear-gradient(180deg, hsl(260 45% 18%), hsl(270 50% 12%))", border: "1px solid hsla(280, 60%, 45%, 0.4)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="font-black text-base mb-3" style={{ color: "hsl(45 95% 70%)" }}>Send Payment</h3>
                  <div className="rounded-2xl p-3 mb-3" style={{ background: "hsla(0,0%,0%,0.4)", border: "1px solid hsla(45,70%,55%,0.35)" }}>
                    <p className="text-[11px] mb-1" style={{ color: "hsl(260 30% 75%)" }}>Send exactly</p>
                    <p className="font-black text-xl" style={{ color: "hsl(45 95% 70%)" }}>
                      {cryptoPayment.payAmount} {cryptoPayment.payCurrency.toUpperCase()}
                    </p>
                  </div>
                  <div className="rounded-2xl p-3 mb-3" style={{ background: "hsla(0,0%,0%,0.4)", border: "1px solid hsla(280,50%,50%,0.3)" }}>
                    <p className="text-[11px] mb-1" style={{ color: "hsl(260 30% 75%)" }}>{cryptoPayment.payCurrency.toUpperCase()} Address</p>
                    <p className="text-xs font-mono break-all select-all" style={{ color: "hsl(0 0% 100%)" }}>{cryptoPayment.payAddress}</p>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(cryptoPayment.payAddress);
                      toast({ title: "Copied!", description: "Address copied to clipboard." });
                    }}
                    className="w-full rounded-xl py-3 font-bold"
                    style={{
                      background: "linear-gradient(135deg, hsl(140 75% 45%), hsl(150 70% 40%))",
                      color: "hsl(0 0% 100%)",
                    }}
                  >
                    Copy Address
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OfferPopup;
