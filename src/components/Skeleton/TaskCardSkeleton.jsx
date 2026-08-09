export default function TaskCardSkeleton() {
  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl p-3 shadow-sm border border-[var(--border-light)] animate-pulse">
      <div className="flex gap-3">
        <div className="w-14 h-14 rounded-lg bg-[var(--bg-secondary)] flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between">
            <div className="h-4 bg-[var(--bg-secondary)] rounded w-3/4" />
            <div className="w-8 h-8 rounded-full bg-[var(--bg-secondary)]" />
          </div>
          <div className="h-3 bg-[var(--bg-secondary)] rounded w-1/3" />
          <div className="flex items-center gap-2 mt-2">
            <div className="h-5 bg-[var(--bg-secondary)] rounded-full w-16" />
            <div className="h-4 bg-[var(--bg-secondary)] rounded w-12" />
          </div>
        </div>
      </div>
    </div>
  )
}
