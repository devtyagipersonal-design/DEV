import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface AmountInputDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (amount: number) => void;
  currency: "dollar" | "star";
  action: "deposit" | "withdraw";
}

const DOLLAR_PRESETS = [1, 5, 10, 50];
const STAR_PRESETS = [100, 500, 1000, 5000];

const AmountInputDialog = ({ open, onClose, onConfirm, currency, action }: AmountInputDialogProps) => {
  const [amount, setAmount] = useState("");
  const presets = currency === "dollar" ? DOLLAR_PRESETS : STAR_PRESETS;
  const symbol = currency === "dollar" ? "$" : "⭐";

  const handleConfirm = () => {
    const num = parseFloat(amount);
    if (num > 0) {
      onConfirm(num);
      setAmount("");
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="fixed left-4 right-4 top-1/2 -translate-y-1/2 z-50 bg-[#1c2230] border border-white/[0.04] rounded-3xl p-5 shadow-2xl max-w-sm mx-auto"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-sm text-white">
                {action === "deposit" ? "Deposit" : "Withdraw"} {symbol}
              </h3>
              <button
                onClick={onClose}
                className="h-7 w-7 rounded-full bg-[#131924] border border-white/[0.04] flex items-center justify-center"
              >
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>

            {/* Preset amounts */}
            <div className="grid grid-cols-4 gap-1.5 mb-4">
              {presets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setAmount(String(preset))}
                  className={`py-2 rounded-xl text-[11px] font-bold transition-all border ${
                    amount === String(preset)
                      ? "border-[#3b82f6] bg-[#3b82f6]/15 text-white"
                      : "border-white/[0.04] bg-[#131924] text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {currency === "dollar" ? `$${preset}` : `${preset}⭐`}
                </button>
              ))}
            </div>

            {/* Custom amount */}
            <div className="mb-4">
              <label className="text-[10px] text-slate-400 font-medium mb-1.5 block">
                Custom Amount
              </label>
              <Input
                type="number"
                placeholder={`Enter amount in ${currency === "dollar" ? "dollars" : "stars"}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="rounded-xl bg-[#131924] border-white/[0.04] text-white text-xs h-9"
                min="1"
              />
            </div>

            <Button
              onClick={handleConfirm}
              disabled={!amount || parseFloat(amount) <= 0}
              className="w-full rounded-xl h-10 font-bold text-xs bg-[#3b82f6] hover:bg-blue-600 text-white"
            >
              {action === "deposit" ? "Deposit" : "Withdraw"}{" "}
              {amount ? (currency === "dollar" ? `$${amount}` : `${amount} ⭐`) : ""}
            </Button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AmountInputDialog;

