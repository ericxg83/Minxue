export default function QuestionCardSkeleton() {
  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl p-3 shadow-sm border border-[var(--border-light)] animate-pulse">
      <div className="flex gap-3">
        <div className="w-5 h-5 rounded-md bg-[var(--bg-secondary)] flex-shrink-0 mt-1" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between">
            <div className="h-3 bg-[var(--bg-secondary)] rounded w-16" />
            <div className="h-5 bg-[var(--bg-secondary)] rounded-full w-14" />
          </div>
          <div className="h-4 bg-[var(--bg-secondary)] rounded w-full" />
          <div className="h-4 bg-[var(--bg-secondary)] rounded w-5/6" />
          <div className="space-y-1.5 mt-3">
            <div className="h-9 bg-[var(--bg-secondary)] rounded-lg" />
            <div className="h-9 bg-[var(--bg-secondary)] rounded-lg" />
            <div className="h-9 bg-[var(--bg-secondary)] rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
