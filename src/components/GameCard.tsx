import { motion } from "framer-motion";
import { Coins, Trophy, Zap } from "lucide-react";

interface GameCardProps {
  title: string;
  icon: React.ReactNode;
  reward: string;
  color: "gold" | "blue";
  delay?: number;
}

const GameCard = ({ title, icon, reward, color, delay = 0 }: GameCardProps) => {
  const colorClasses = color === "gold" 
    ? "from-primary/20 to-primary/5 border-primary/30 box-glow" 
    : "from-secondary/20 to-secondary/5 border-secondary/30 box-glow-blue";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      whileTap={{ scale: 0.97 }}
      className={`cursor-pointer rounded-2xl border bg-gradient-to-br p-4 ${colorClasses}`}
    >
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60">
          {icon}
        </div>
        <div>
          <h3 className="font-game text-sm text-foreground">{title}</h3>
          <p className="flex items-center gap-1 text-xs text-primary">
            <Coins className="h-3 w-3" /> {reward}
          </p>
        </div>
      </div>
    </motion.div>
  );
};

export default GameCard;
