import { motion } from "framer-motion";
import { Gamepad2, Store, Gift, Users, Wallet } from "lucide-react";

const tabs = [
  { icon: Gamepad2, label: "Games", activeColor: "#ef4444" },
  { icon: Store, label: "Market", activeColor: "#f59e0b" },
  { icon: Gift, label: "Earn", activeColor: "#eab308" },
  { icon: Users, label: "Invite", activeColor: "#a855f7" },
  { icon: Wallet, label: "Wallet", activeColor: "#10b981" },
];

interface BottomNavProps {
  activeTab: number;
  onTabChange: (index: number) => void;
}

const BottomNav = ({ activeTab, onTabChange }: BottomNavProps) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#111622]/90 backdrop-blur-md border-t border-white/[0.04]">
      <div className="mx-auto flex max-w-md items-center justify-around py-2">
        {tabs.map((tab, i) => {
          const isActive = activeTab === i;
          const Icon = tab.icon;
          return (
            <motion.button
              key={tab.label}
              onClick={() => onTabChange(i)}
              whileTap={{ scale: 0.9 }}
              className="flex flex-col items-center gap-1 px-4 py-1 relative"
            >
              {isActive && (
                <motion.div
                  layoutId="activeTabGlow"
                  className="absolute -top-2 w-10 h-0.5 rounded-full"
                  style={{
                    background: tab.activeColor,
                    boxShadow: `0 0 10px ${tab.activeColor}`,
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                />
              )}
              <motion.div
                animate={{
                  scale: isActive ? 1.15 : 0.95,
                  opacity: isActive ? 1 : 0.5,
                }}
                transition={{ type: "spring", stiffness: 200 }}
                className="h-6 w-6 flex items-center justify-center transition-colors"
                style={{
                  color: isActive ? tab.activeColor : "#94a3b8",
                  filter: isActive ? `drop-shadow(0 0 4px ${tab.activeColor}40)` : "none",
                }}
              >
                <Icon className="h-5 w-5 stroke-[2.2]" />
              </motion.div>
              <motion.span
                className="text-[10px] font-bold"
                animate={{ opacity: isActive ? 1 : 0.5 }}
                style={{ color: isActive ? tab.activeColor : "#94a3b8" }}
              >
                {tab.label}
              </motion.span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};

export default BottomNav;
