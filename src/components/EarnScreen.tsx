import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import createAdHandler from "monetag-tg-sdk";
import clapperboardIcon from "@/assets/icon-clapperboard.png";
import { useBalanceContext } from "@/contexts/BalanceContext";
import { getTelegramUser } from "@/lib/telegram";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://broken-bria-chetan1-ea890b93.koyeb.app/api";

// Initialize Monetag ad handler with zone ID
const adHandler = createAdHandler(10648653);

const tasks = [
  {
    title: "Watch short ads",
    subtitle: "Rewarded Interstitial",
    emoji: "🤩",
    maxAds: 5,
  },
  {
    title: "Click to get reward",
    subtitle: "Rewarded Popup",
    emoji: "😎",
    maxAds: 7,
  },
];

const getTodayKey = () => new Date().toISOString().slice(0, 10);

const loadTodayCounts = (): number[] => {
  try {
    const saved = localStorage.getItem("earn_ad_counts");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.date === getTodayKey()) return parsed.counts;
    }
  } catch {}
  return tasks.map(() => 0);
};

const saveTodayCounts = (counts: number[]) => {
  localStorage.setItem("earn_ad_counts", JSON.stringify({ date: getTodayKey(), counts }));
};

const EarnScreen = () => {
  const [adCounts, setAdCounts] = useState<number[]>(loadTodayCounts);
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  const { refreshBalance } = useBalanceContext();

  const handleClaim = async (idx: number) => {
    if (loadingIdx !== null) return;
    if (adCounts[idx] >= tasks[idx].maxAds) {
      toast.info("Today's limit reached! Come back tomorrow.");
      return;
    }

    setLoadingIdx(idx);
    try {
      const user = getTelegramUser();
      const userId = user?.id || "demo";

      await adHandler(String(userId));

      const newCounts = [...adCounts];
      newCounts[idx] += 1;
      setAdCounts(newCounts);
      saveTodayCounts(newCounts);

      await fetch(`${API_BASE_URL}/game/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          betAmount: 0,
          winAmount: 1,
          currency: "star",
          game: "ad-reward",
        }),
      });

      refreshBalance();
      toast.success(`Ad complete! +1 ⭐ earned (${newCounts[idx]}/${tasks[idx].maxAds})`);
    } catch {
      toast.info("Ad skipped or closed.");
    } finally {
      setLoadingIdx(null);
    }
  };

  const totalWatched = adCounts.reduce((a, b) => a + b, 0);

  return (
    <div className="px-4 pt-4 space-y-4 bg-[#0b0e14] text-slate-100 min-h-screen">
      <h2 className="font-bold text-base text-slate-200 flex items-center gap-2">
        🕹️ Daily Tasks
      </h2>

      <div className="space-y-2.5">
        {tasks.map((task, i) => (
          <motion.div
            key={task.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center gap-3.5 p-3 rounded-2xl bg-[#1c2230] border border-white/[0.04] shadow-md"
          >
            <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 text-2xl bg-[#131924] border border-white/[0.04]">
              {task.emoji}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-xs truncate text-white">
                {task.title}
              </h4>
              <p className="text-[10px] truncate text-slate-400 mt-0.5">
                {task.subtitle} • {adCounts[i]}/{task.maxAds}
              </p>
            </div>
            {adCounts[i] >= task.maxAds ? (
              <span className="px-3.5 py-1.5 rounded-xl text-[10px] font-bold shrink-0 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                Done
              </span>
            ) : (
              <button
                onClick={() => handleClaim(i)}
                disabled={loadingIdx !== null}
                className="px-3.5 py-1.5 rounded-xl text-[10px] font-bold shrink-0 active:scale-95 transition-transform bg-[#3b82f6] text-white hover:bg-blue-600 border border-blue-500/20 disabled:opacity-50"
              >
                {loadingIdx === i ? "..." : "Claim"}
              </button>
            )}
          </motion.div>
        ))}
      </div>

      <p className="text-center text-xs font-semibold text-slate-400">
        Ads Watched Today: <span className="text-white font-bold">{totalWatched}</span> / {tasks.reduce((a, t) => a + t.maxAds, 0)} 🎬
      </p>

      <div className="text-[10px] text-slate-400 text-center px-2 space-y-1 pt-2 border-t border-white/[0.04]">
        <p>📌 1 ad dekhne par 1 ⭐ milega! / Watch 1 ad to earn 1 ⭐!</p>
        <p>💰 Ads se milne wale stars aapke Star wallet mein add honge.</p>
      </div>
    </div>
  );
};

export default EarnScreen;
