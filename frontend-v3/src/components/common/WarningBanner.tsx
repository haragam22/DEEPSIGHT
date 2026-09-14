import { AnimatePresence, motion } from 'framer-motion'
import { TriangleAlert } from 'lucide-react'

// The A4 & SSS survey no longer emits a "synthetic navigation" disclaimer, but older
// in-memory surveys still might. Drop that one line here so it never reaches the UI.
const HIDDEN = /synthetic navigation|SSS Mine Detection test tiles/i

export function WarningBanner({ warnings }: { warnings: string[] }) {
  const shown = warnings.filter((w) => !HIDDEN.test(w))
  return (
    <AnimatePresence>
      {shown.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="flex gap-2.5 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <ul className="space-y-0.5">
              {shown.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
