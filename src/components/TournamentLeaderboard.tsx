import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Trophy, Crown, Medal, Clock } from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://broken-bria-chetan1-ea890b93.koyeb.app/api";

export interface PrizeTier { fromRank: number; toRank: number; amount: number; }
export interface Tournament {
  _id: string;
  title: string;
  imageUrl?: string;
  prizeCurrency: "dollar" | "star";
  tier: number;
  prizePerWinner: number;
  prizeTiers?: PrizeTier[];
  gameFilter?: string;
  startedAt: string;
  endsAt?: string | null;
  active: boolean;
}

interface LeaderboardEntry {
  rank: number;
  telegramId: number;
  gamesPlayed: number;
  firstName: string;
  username: string;
  prize: number;
  currency: "dollar" | "star";
}

interface Props {
  tournament: Tournament;
  onClose: () => void;
}

function formatRemaining(ms: number) {
  if (ms <= 0) return "Ended";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m ${sec}s`;
  return `${h}h ${m}m ${sec}s`;
}

const TournamentLeaderboard = ({ tournament, onClose }: Props) => {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/tournaments/${tournament._id}/leaderboard`);
        if (r.ok) {
          const d = await r.json();
          setEntries(d.leaderboard || []);
        }
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [tournament._id]);

  const sym = tournament.prizeCurrency === "dollar" ? "$" : "⭐";
  const remainingMs = tournament.endsAt ? new Date(tournament.endsAt).getTime() - now : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[85vh] overflow-hidden flex flex-col bg-[#1c2230] border border-white/[0.04] shadow-2xl"
      >
        {/* Header */}
        <div className="p-4 flex items-center gap-3 border-b border-white/[0.04]">
          <div className="h-9 w-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <Trophy className="h-5 w-5 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-sm truncate text-white">{tournament.title}</h2>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Top {tournament.tier} •{" "}
              {tournament.prizeTiers && tournament.prizeTiers.length > 0
                ? `1st ${sym}${tournament.prizeTiers[0].amount}`
                : `Prize ${sym}${tournament.prizePerWinner} each`}
            </p>
            {tournament.endsAt && (
              <p className={`text-[10px] flex items-center gap-1 mt-0.5 font-bold ${remainingMs > 0 ? "text-emerald-400" : "text-red-400"}`}>
                <Clock className="h-3 w-3" />
                {formatRemaining(remainingMs)}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-full bg-[#131924] border border-white/[0.04] flex items-center justify-center shrink-0"
          >
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-3 space-y-2">
          {loading ? (
            <p className="text-center py-10 text-xs text-slate-400">Loading...</p>
          ) : entries.length === 0 ? (
            <p className="text-center py-10 text-xs text-slate-400">
              No players yet. Play games to enter the Top {tournament.tier}!
            </p>
          ) : (
            entries.map((e) => {
              const isTop3 = e.rank <= 3;
              const rankColor =
                e.rank === 1 ? "#f59e0b" :
                e.rank === 2 ? "#94a3b8" :
                e.rank === 3 ? "#f97316" : "#64748b";
              return (
                <div
                  key={e.telegramId}
                  className={`flex items-center gap-3 rounded-2xl p-2.5 border ${
                    isTop3
                      ? "bg-amber-500/5 border-amber-500/15"
                      : "bg-[#131924] border-white/[0.04]"
                  }`}
                >
                  <div className="w-8 flex justify-center shrink-0">
                    {e.rank === 1 ? (
                      <Crown className="h-5 w-5" style={{ color: rankColor }} />
                    ) : e.rank <= 3 ? (
                      <Medal className="h-5 w-5" style={{ color: rankColor }} />
                    ) : (
                      <span className="text-xs font-bold" style={{ color: rankColor }}>#{e.rank}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate text-white">{e.firstName}</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">{e.gamesPlayed} games played</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-emerald-400">+{sym}{e.prize}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default TournamentLeaderboard;

