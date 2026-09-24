import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, FolderGit2, Loader2 } from "lucide-react";

const DESTINATION = "https://projecthub-me.vercel.app/pbad";
const DESTINATION_HOST = "projecthub-me.vercel.app";
const WAIT_MS = 3000;

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

export default function RedirectPage() {
  const [progress, setProgress] = useState(0);
  const [remaining, setRemaining] = useState(Math.ceil(WAIT_MS / 1000));
  // Never bounce back to ourselves — guards against a redirect loop if this
  // bundle is ever served from the destination host.
  const alreadyAtDestination =
    typeof window !== "undefined" && window.location.hostname === DESTINATION_HOST;

  useEffect(() => {
    if (alreadyAtDestination) return;

    const startedAt = Date.now();
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / WAIT_MS, 1);
      setProgress(ratio * 100);
      setRemaining(Math.max(Math.ceil((WAIT_MS - elapsed) / 1000), 0));

      if (ratio >= 1) {
        window.clearInterval(tick);
        window.location.replace(DESTINATION);
      }
    }, 50);

    return () => window.clearInterval(tick);
  }, [alreadyAtDestination]);

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-slate-950 px-4 py-10">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <motion.div
          className="absolute -left-24 top-[-10%] h-[26rem] w-[26rem] rounded-full bg-sky-500/30 blur-[110px]"
          animate={{ x: [0, 60, -20, 0], y: [0, 40, 80, 0], scale: [1, 1.15, 0.95, 1] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -right-20 top-1/4 h-[24rem] w-[24rem] rounded-full bg-fuchsia-500/25 blur-[110px]"
          animate={{ x: [0, -50, 20, 0], y: [0, -30, 50, 0], scale: [1, 1.2, 1, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-[-15%] left-1/3 h-[22rem] w-[22rem] rounded-full bg-emerald-400/20 blur-[110px]"
          animate={{ x: [0, 40, -40, 0], y: [0, -40, 10, 0], scale: [1, 0.9, 1.1, 1] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.12),transparent_60%)]" />
      </div>

      <motion.div
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } } }}
        className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl shadow-sky-500/10 backdrop-blur-xl sm:p-10"
      >
        <motion.div variants={fadeUp} className="flex justify-center">
          <div className="relative">
            <motion.span
              className="absolute inset-0 rounded-2xl bg-sky-400/40 blur-xl"
              animate={{ opacity: [0.35, 0.8, 0.35], scale: [1, 1.12, 1] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-gradient-to-br from-sky-500 to-indigo-600 shadow-lg">
              <FolderGit2 className="h-8 w-8 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          className="mt-6 bg-gradient-to-r from-white via-sky-100 to-sky-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl"
        >
          ProjectHub
        </motion.h1>

        <motion.p variants={fadeUp} className="mt-3 text-sm text-slate-300 sm:text-base">
          You are being securely forwarded to the dashboard.
        </motion.p>

        <motion.div variants={fadeUp} className="mt-8">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 via-cyan-300 to-emerald-300 transition-[width] duration-100 ease-linear"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              aria-label="Redirect progress"
            />
          </div>
          <div className="mt-3 flex items-center justify-center gap-2 text-xs font-medium text-slate-400">
            {alreadyAtDestination ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>You are already at the destination.</span>
              </>
            ) : (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>
                  {remaining > 0 ? `Redirecting in ${remaining}s…` : "Redirecting now…"}
                </span>
              </>
            )}
          </div>
        </motion.div>

        <motion.p variants={fadeUp} className="mt-8 break-all text-[11px] text-slate-500">
          {DESTINATION}
        </motion.p>
      </motion.div>
    </div>
  );
}
