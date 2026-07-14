import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingCart, User, Shield, Sparkles, Flame, X, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBalanceContext } from "@/contexts/BalanceContext";
import { getTelegramUser } from "@/lib/telegram";
import BottomNav from "./BottomNav";
import EarnScreen from "./EarnScreen";
import FriendsScreen from "./FriendsScreen";
import WalletScreen from "./WalletScreen";
import MarketScreen from "./MarketScreen";
import TournamentLeaderboard, { Tournament } from "./TournamentLeaderboard";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `${window.location.origin}/api`;

type FilterTab = "all" | "tournament" | "wheel" | "crash" | "slots";

import greedyKingThumb from "@/assets/greedy-king-thumb.png";
import gameDice from "@/assets/dice.webp";
import gameCarnivalSpin from "@/assets/carnival.webp";
import gameMines from "@/assets/mines.webp";
import gameAviator from "@/assets/aviator.jpg";
import gamePlinko from "@/assets/plinko.webp";
import gameChickenRoad from "@/assets/chicken.webp";
import gameGoblin from "@/assets/goblin.webp";
import gameTwist from "@/assets/twist.webp";



interface GameTileProps {
  image: string;
  name: string;
  description: string;
  badge?: string;
  badgeGradient?: string;
  delay?: number;
  onClick?: () => void;
}

const GameTile = ({ image, name, description, badge, badgeGradient, delay = 0, onClick }: GameTileProps) => (
  <motion.div
    initial={{ opacity: 0, y: 15 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.3 }}
    whileTap={{ scale: 0.96 }}
    whileHover={{ y: -3 }}
    onClick={onClick}
    className="cursor-pointer w-full bg-[#1c2230] rounded-2xl p-2.5 border border-white/[0.04] shadow-md hover:shadow-lg transition-shadow duration-200"
  >
    <div className="relative rounded-xl overflow-hidden aspect-square mb-2 bg-[#131924]">
      <img src={image} alt={name} className="w-full h-full object-cover transition-transform duration-300 hover:scale-105" />
      {badge && (
        <span
          className="absolute top-1.5 left-1.5 text-white text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider"
          style={{
            background: badgeGradient || "linear-gradient(135deg, #10b981, #059669)",
          }}
        >
          {badge}
        </span>
      )}
    </div>
    <h4 className="font-bold text-xs truncate text-white">{name}</h4>
    <p className="text-[10px] truncate text-slate-400 mt-0.5">{description}</p>
  </motion.div>
);

const HomeScreen = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(0);
  const [showProfile, setShowProfile] = useState(false);
  const { dollarBalance, starBalance, dollarWinning, starWinning } = useBalanceContext();
  const totalDollar = dollarBalance + dollarWinning;
  const totalStar = starBalance + starWinning;
  const [filter, setFilter] = useState<FilterTab>("all");
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [openTournament, setOpenTournament] = useState<Tournament | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    // Only tick the countdown clock when there are tournaments with endsAt.
    // Without this gate, every HomeScreen child re-renders every second on Android → flicker.
    const hasTimedTournament = tournaments.some((t) => !!t.endsAt);
    if (!hasTimedTournament) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [tournaments]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/tournaments/active`)
      .then((r) => r.ok ? r.json() : { tournaments: [] })
      .then((d) => setTournaments(d.tournaments || []))
      .catch(() => {});
  }, []);

  const formatRemaining = (ms: number) => {
    if (ms <= 0) return "Ended";
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    return `${m}m ${sec}s`;
  };

  const goToGreedyKing = () => navigate("/greedy-king");
  const goToDiceMaster = () => navigate("/dice-master");
  const goToCarnivalSpin = () => navigate("/carnival-spin");
  const goToMines = () => navigate("/mines");
  const goToMinesClassic = () => navigate("/mines-classic");
  const goToAviator = () => navigate("/aviator");
  const goToAviatorFun = () => navigate("/aviator-fun");
  const goToPlinko = () => navigate("/plinko");
  const goToChickenRoad = () => navigate("/chicken-road");
  const goToChickenClassic = () => navigate("/chicken-classic");
  const goToTwist = () => navigate("/twist");
  const goToGoblinTower = () => navigate("/goblin-tower");
  
  
  
  const goToAdmin = () => navigate("/admin");

  const telegramUser = getTelegramUser();
  const isOwner = telegramUser?.id === 6965488457;

  const renderTabContent = () => {
    switch (activeTab) {
      case 1: return <MarketScreen onGoToWallet={() => setActiveTab(4)} />;
      case 2: return <EarnScreen />;
      case 3: return <FriendsScreen />;
      case 4: return <WalletScreen />;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen pb-20 relative bg-[#0b0e14] text-slate-100 font-sans">
      {/* Background container - flat and simple */}
      <div className="fixed inset-0 z-0 bg-[#0b0e14]" />

      {/* Top Bar — Simple and Clean */}
      <div className="sticky top-0 z-30 px-3 py-2 flex items-center justify-between gap-1.5 bg-[#111622]/90 backdrop-blur-md border-b border-white/[0.04]">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {/* Dollar badge */}
          <motion.div
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 cursor-pointer"
          >
            <span className="text-[10px]">💲</span>
            <span className="font-bold text-[10px] text-emerald-400">
              {totalDollar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </motion.div>
          {/* Star badge */}
          <motion.div
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 cursor-pointer"
          >
            <span className="text-[10px]">⭐</span>
            <span className="font-bold text-[10px] text-amber-400">
              {totalStar.toLocaleString()}
            </span>
          </motion.div>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && (
            <motion.div
              whileTap={{ scale: 0.9 }}
              onClick={goToAdmin}
              className="h-7 w-7 rounded-lg flex items-center justify-center cursor-pointer bg-rose-500/10 border border-rose-500/20"
            >
              <Shield className="h-3.5 w-3.5 text-rose-400" />
            </motion.div>
          )}
          <motion.div
            whileTap={{ scale: 0.9 }}
            className="h-7 w-7 rounded-lg flex items-center justify-center cursor-pointer bg-slate-800/80 border border-slate-700/50"
          >
            <ShoppingCart className="h-3.5 w-3.5 text-slate-300" />
          </motion.div>
          <motion.div
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowProfile(true)}
            className="h-7 w-7 rounded-lg overflow-hidden flex items-center justify-center cursor-pointer bg-slate-800/80 border border-slate-700/50"
          >
            <User className="h-3.5 w-3.5 text-slate-300" />
          </motion.div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 0 ? (
          <motion.div key="games" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="relative z-10">
            <div className="px-4 space-y-5 mt-4">

              {/* 🔥 Hot Games Banner */}
              <div className="rounded-2xl p-3.5 flex items-center gap-3 bg-[#1c2230] border border-white/[0.04]">
                <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <Flame className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <h3 className="font-bold text-xs text-white">Play & Win Real Rewards!</h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">Select a game below to start winning</p>
                </div>
                <div className="ml-auto text-amber-400">
                  <Sparkles className="h-4 w-4 animate-pulse" />
                </div>
              </div>

              {/* Filter chips */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1">
                {([
                  { key: "all", label: "All", emoji: "🎮" },
                  { key: "tournament", label: "Tournament", emoji: "🏆" },
                  { key: "wheel", label: "Wheel", emoji: "🎡" },
                  { key: "crash", label: "Crash", emoji: "🚀" },
                  { key: "slots", label: "Slots", emoji: "🎰" },
                ] as { key: FilterTab; label: string; emoji: string }[]).map((c) => {
                  const active = filter === c.key;
                  return (
                    <motion.button
                      key={c.key}
                      whileTap={{ scale: 0.94 }}
                      onClick={() => setFilter(c.key)}
                      className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[11px] font-bold whitespace-nowrap shrink-0 transition-all border"
                      style={{
                        background: active ? "#3b82f6" : "#1c2230",
                        color: active ? "#ffffff" : "#94a3b8",
                        borderColor: active ? "#3b82f6" : "rgba(255, 255, 255, 0.04)",
                      }}
                    >
                      <span>{c.emoji}</span>{c.label}
                    </motion.button>
                  );
                })}
              </div>

              {/* Tournament Section */}
              {(filter === "all" || filter === "tournament") && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold text-sm flex items-center gap-1.5 text-slate-200">
                      <Trophy className="h-4 w-4 text-amber-500" />
                      <span>Active Tournaments</span>
                    </h2>
                  </div>
                  {tournaments.length === 0 ? (
                    <div className="rounded-2xl p-5 text-center text-[11px] bg-[#1c2230] border border-dashed border-white/[0.04] text-slate-400">
                      No active tournaments right now.
                    </div>
                  ) : (
                    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                       {tournaments.map((t) => {
                        const sym = t.prizeCurrency === "dollar" ? "$" : "⭐";
                        const firstPrize = t.prizeTiers && t.prizeTiers.length > 0 ? t.prizeTiers[0].amount : t.prizePerWinner;
                        const remainingMs = t.endsAt ? new Date(t.endsAt).getTime() - now : 0;
                        return (
                          <motion.div
                            key={t._id}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => setOpenTournament(t)}
                            className="cursor-pointer flex-shrink-0 w-[190px] rounded-2xl overflow-hidden bg-[#1c2230] border border-white/[0.04] shadow-md"
                          >
                            <div className="aspect-[16/10] relative overflow-hidden bg-[#131924]">
                              {t.imageUrl ? (
                                <img src={t.imageUrl} alt={t.title} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-indigo-500/10">
                                  <Trophy className="h-8 w-8 text-indigo-400" />
                                </div>
                              )}
                              <div className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded bg-[#0b0e14]/85 text-[8px] font-bold text-amber-400">
                                TOP {t.tier}
                              </div>
                              {t.endsAt && (
                                <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded text-[8px] font-semibold bg-[#0b0e14]/85 text-slate-200">
                                  ⏱ {formatRemaining(remainingMs)}
                                </div>
                              )}
                            </div>
                            <div className="p-2.5 space-y-0.5">
                              <p className="text-[11px] font-bold truncate text-white">{t.title}</p>
                              <p className="text-[10px] text-amber-400 font-semibold">
                                1st Prize: {sym}{firstPrize}
                              </p>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {/* Wheel Category */}
              {(filter === "all" || filter === "wheel") && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-sm flex items-center gap-1.5 text-slate-200">
                    <span>🎡</span>
                    <span>Wheel & Spin</span>
                  </h2>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <GameTile
                    image={greedyKingThumb}
                    name="Greedy King"
                    description="Spin matches, win multiplier rewards!"
                    badge="🔥 HOT"
                    badgeGradient="linear-gradient(135deg, #ef4444, #f97316)"
                    delay={0.05}
                    onClick={goToGreedyKing}
                  />
                  <GameTile
                    image={gameTwist}
                    name="Twist Game"
                    description="Spin colored rings, align high tier gems!"
                    badge="🎰 SPIN"
                    badgeGradient="linear-gradient(135deg, #3b82f6, #6366f1)"
                    delay={0.1}
                    onClick={goToTwist}
                  />
                </div>
              </section>
              )}

              {/* Crash Category */}
              {(filter === "all" || filter === "crash") && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-sm flex items-center gap-1.5 text-slate-200">
                    <span>🚀</span>
                    <span>Crash Multipliers</span>
                  </h2>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <GameTile
                    image={gameAviator}
                    name="Aviator"
                    description="Multiply your bets, cashout before crash!"
                    badge="🚀 ROCKET"
                    badgeGradient="linear-gradient(135deg, #ec4899, #f43f5e)"
                    delay={0.05}
                    onClick={goToAviator}
                  />
                  <GameTile
                    image={gameChickenRoad}
                    name="Chicken Road"
                    description="Dodge traffic lanes, cross safety paths!"
                    badge="🐔 ROAD"
                    badgeGradient="linear-gradient(135deg, #f59e0b, #eab308)"
                    delay={0.1}
                    onClick={goToChickenRoad}
                  />
                  <GameTile
                    image={gameChickenRoad}
                    name="Chicken Classic"
                    description="Walk straight lanes, avoid roasted crash!"
                    badge="🐔 CLASSIC"
                    badgeGradient="linear-gradient(135deg, #10b981, #059669)"
                    delay={0.15}
                    onClick={goToChickenClassic}
                  />
                  <GameTile
                    image={gameAviator}
                    name="Aviator Fun"
                    description="Fast multiplier crash — cashout at the right moment!"
                    badge="⚡ TURBO"
                    badgeGradient="linear-gradient(135deg, #f97316, #ef4444)"
                    delay={0.2}
                    onClick={goToAviatorFun}
                  />
                </div>
              </section>
              )}

              {/* Slots Category */}
              {(filter === "all" || filter === "slots") && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-sm flex items-center gap-1.5 text-slate-200">
                    <span>🎰</span>
                    <span>Slots & Table Games</span>
                  </h2>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <GameTile
                    image={gameDice}
                    name="Dice Master"
                    description="Predict roll bounds, multiply coins!"
                    badge="🎲 NEW"
                    badgeGradient="linear-gradient(135deg, #3b82f6, #2563eb)"
                    delay={0.05}
                    onClick={goToDiceMaster}
                  />
                  <GameTile
                    image={gameCarnivalSpin}
                    name="Carnival Spin"
                    description="Spin the lucky wheel, collect rewards!"
                    badge="🎪 SPIN"
                    badgeGradient="linear-gradient(135deg, #8b5cf6, #7c3aed)"
                    delay={0.1}
                    onClick={goToCarnivalSpin}
                  />
                  <GameTile
                    image={gameMines}
                    name="Mines"
                    description="Avoid hidden explosive mine traps!"
                    badge="💣 MINES"
                    badgeGradient="linear-gradient(135deg, #ef4444, #dc2626)"
                    delay={0.15}
                    onClick={goToMines}
                  />
                  <GameTile
                    image={gameMines}
                    name="Mines Classic"
                    description="Classical mines game with question marks!"
                    badge="💣 CLASSIC"
                    badgeGradient="linear-gradient(135deg, #ef4444, #dc2626)"
                    delay={0.18}
                    onClick={goToMinesClassic}
                  />
                  <GameTile
                    image={gamePlinko}
                    name="Plinko"
                    description="Drop ball pegs, aim for high slots!"
                    badge="🎪 BALL"
                    badgeGradient="linear-gradient(135deg, #f59e0b, #d97706)"
                    delay={0.22}
                    onClick={goToPlinko}
                  />
                  <GameTile
                    image={gameGoblin}
                    name="Goblin Tower"
                    description="Climb levels, step around dark goblins!"
                    badge="👹 TOWER"
                    badgeGradient="linear-gradient(135deg, #a855f7, #9333ea)"
                    delay={0.25}
                    onClick={goToGoblinTower}
                  />
                </div>
              </section>
              )}

            </div>
          </motion.div>
        ) : (
          <motion.div key={`tab-${activeTab}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="relative z-10">
            {renderTabContent()}
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />

      <AnimatePresence>
        {openTournament && (
          <TournamentLeaderboard tournament={openTournament} onClose={() => setOpenTournament(null)} />
        )}
      </AnimatePresence>

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-6 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowProfile(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[290px] rounded-3xl p-5 relative bg-[#1c2230] border border-white/[0.04] shadow-xl"
            >
              <button
                onClick={() => setShowProfile(false)}
                className="absolute top-3 right-3 h-7 w-7 rounded-full flex items-center justify-center bg-[#131924] hover:bg-slate-800 transition-colors"
              >
                <X className="h-4 w-4 text-slate-400" />
              </button>

              <div className="flex flex-col items-center gap-3">
                <div className="h-14 w-14 rounded-2xl flex items-center justify-center bg-[#131924] border border-white/[0.04]">
                  <User className="h-6 w-6 text-slate-300" />
                </div>

                <div className="text-center space-y-0.5">
                  <h3 className="font-bold text-sm text-white">
                    {telegramUser?.first_name || "User"} {telegramUser?.last_name || ""}
                  </h3>
                  {telegramUser?.username && (
                    <p className="text-[10px] text-slate-400">@{telegramUser.username}</p>
                  )}
                </div>

                <div className="w-full rounded-2xl p-3.5 mt-1 space-y-2.5 bg-[#131924] border border-white/[0.04]">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-400">Telegram ID</span>
                    <span className="text-[10px] font-bold text-slate-200">{telegramUser?.id || "N/A"}</span>
                  </div>
                  <div className="h-px bg-white/[0.04]" />
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-400">💲 Balance</span>
                    <span className="text-[10px] font-bold text-emerald-400">${totalDollar.toFixed(2)}</span>
                  </div>
                  <div className="h-px bg-white/[0.04]" />
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-400">⭐ Stars</span>
                    <span className="text-[10px] font-bold text-amber-400">{totalStar.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default HomeScreen;
