import { motion } from "framer-motion";
import { Copy, Send, Check } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "@/hooks/use-toast";
import { getTelegramUser, getTelegram } from "@/lib/telegram";
import { useBalance } from "@/hooks/useBalance";

const inviteTasks = [
  { title: "Invite 1st friend", reward: "5 ⭐", icon: "⭐", target: 1 },
  { title: "Invite 2nd friend", reward: "5 ⭐", icon: "⭐", target: 2 },
  { title: "Invite 3rd friend", reward: "5 ⭐", icon: "⭐", target: 3 },
];

const FriendsScreen = () => {
  const user = getTelegramUser();
  const userId = user?.id || "unknown";
  const referralLink = `https://t.me/RoyalKingGameBot?start=ref_${userId}`;
  const { data } = useBalance();
  const referralCount = data?.referralCount || 0;

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    toast({ title: "Copied!", description: "Referral link copied to clipboard" });
  };

  return (
    <div className="px-4 pt-4 space-y-5 bg-[#0b0e14] text-slate-100 min-h-screen">
      {/* Header */}
      <div className="text-center space-y-1">
        <h2 className="font-bold text-lg text-white">Invite Friends</h2>
        <p className="text-slate-400 text-[11px]">Share the referral link to earn bonus stars!</p>
      </div>

      {/* Referral Link Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[#1c2230] border border-white/[0.04] rounded-2xl p-4 space-y-3 shadow-md"
      >
        <p className="text-[10px] text-slate-400">Your unique referral link</p>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-[#131924] border border-white/[0.04] rounded-xl px-3.5 py-2 font-mono text-[11px] text-slate-200 truncate">
            {referralLink}
          </div>
          <Button size="icon" variant="ghost" onClick={copyLink} className="rounded-xl h-9 w-9 shrink-0 bg-[#131924] hover:bg-slate-800 border border-white/[0.04]">
            <Copy className="h-4 w-4 text-slate-300" />
          </Button>
        </div>
        <Button
          className="w-full rounded-xl h-11 text-xs font-bold bg-[#3b82f6] hover:bg-blue-600 text-white border border-blue-500/20 active:scale-98 transition-transform"
          onClick={() => {
            const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("🎮 Royal King Game khelo aur stars kamao! Join karo mere referral link se!")}`;
            const tg = getTelegram();
            if (tg?.openTelegramLink) {
              tg.openTelegramLink(shareUrl);
            } else {
              window.open(shareUrl, "_blank");
            }
          }}
        >
          <Send className="h-4 w-4 mr-1.5" /> Invite Friends
        </Button>
      </motion.div>

      {/* Invite Tasks */}
      <div className="space-y-2.5">
        {inviteTasks.map((task, i) => {
          const completed = referralCount >= task.target;
          return (
            <motion.div
              key={task.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`flex items-center gap-3 p-3 rounded-2xl border ${completed ? "bg-emerald-500/10 border-emerald-500/20" : "bg-[#1c2230] border-white/[0.04]"}`}
            >
              <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 text-xl ${completed ? "bg-emerald-500/20" : "bg-[#131924] border border-white/[0.04]"}`}>
                {completed ? <Check className="h-5 w-5 text-emerald-400" /> : "🧑‍🤝‍🧑"}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-xs text-white">{task.title}</h4>
                {completed && <p className="text-[9px] text-emerald-400 mt-0.5">Completed</p>}
              </div>
              <span className="text-xs font-bold text-slate-200 shrink-0">{task.reward}</span>
              <span className="text-sm shrink-0 ml-1">{task.icon}</span>
            </motion.div>
          );
        })}
      </div>

      {/* Total Referral Count */}
      <div className="bg-[#1c2230] border border-white/[0.04] rounded-2xl p-3 text-center shadow-sm">
        <p className="text-slate-400 text-[10px] mb-0.5">Total Referrals</p>
        <p className="text-2xl font-bold text-white">{referralCount}</p>
      </div>

      <div className="text-[10px] text-slate-400 text-center px-2 space-y-1 pt-2 border-t border-white/[0.04]">
        <p>📌 Har refer par aapko 5 ⭐ milega — jab aapka friend pehli baar deposit karega.</p>
        <p>⭐ Refer se milne wale Stars aapke Star wallet mein add honge.</p>
      </div>
    </div>
  );
};

export default FriendsScreen;
