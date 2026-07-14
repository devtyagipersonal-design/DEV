import { motion } from "framer-motion";
import { Crown, Sparkles } from "lucide-react";

const SplashScreen = () => {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#0b0e14] py-16 px-6 overflow-hidden"
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: "easeInOut" }}
    >
      {/* Background Radial Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(245,158,11,0.06)_0%,transparent_70%)] pointer-events-none" />

      {/* Top spacing to balance layout */}
      <div className="h-4" />

      {/* Main Content Area */}
      <div className="flex flex-col items-center justify-center relative z-10">
        {/* Animated Crown Emblem */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="relative mb-6"
        >
          {/* Outer Glow */}
          <div className="absolute inset-0 bg-amber-500/20 blur-2xl rounded-full scale-125 animate-pulse" />
          
          <div className="relative h-20 w-20 rounded-2xl bg-gradient-to-b from-amber-400 to-amber-600 p-[1.5px] shadow-[0_0_30px_rgba(245,158,11,0.2)]">
            <div className="h-full w-full rounded-[14px] bg-[#111622] flex items-center justify-center">
              <Crown className="h-10 w-10 text-amber-500 drop-shadow-[0_2px_8px_rgba(245,158,11,0.4)]" />
            </div>
          </div>

          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
            className="absolute -top-1 -right-1 text-amber-400/80"
          >
            <Sparkles className="h-4 w-4" />
          </motion.div>
        </motion.div>

        {/* Brand Text */}
        <motion.div
          initial={{ y: 15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="text-center"
        >
          <h1 className="text-2xl font-black tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-amber-200">
            ROYAL KING
          </h1>
          <p className="text-[10px] font-bold tracking-[0.4em] text-slate-400 uppercase mt-2">
            GAME BOT
          </p>
        </motion.div>
      </div>

      {/* Loading Indicator Area */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="flex flex-col items-center gap-4 relative z-10"
      >
        {/* Sleek Custom Spinner */}
        <div className="relative h-8 w-8">
          <div className="absolute inset-0 rounded-full border-2 border-white/[0.04]" />
          <div className="absolute inset-0 rounded-full border-2 border-t-amber-500 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
        </div>
        
        <span className="text-[9px] font-bold tracking-[0.25em] text-slate-500 uppercase animate-pulse">
          Securing Connection
        </span>
      </motion.div>
    </motion.div>
  );
};

export default SplashScreen;
