export default function ExamCardSkeleton() {
  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl p-3 border border-[var(--border-light)] animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <div className="h-4 bg-[var(--bg-secondary)] rounded w-3/4" />
          <div className="h-3 bg-[var(--bg-secondary)] rounded w-1/3" />
        </div>
        <div className="h-5 bg-[var(--bg-secondary)] rounded-full w-14" />
      </div>
      <div className="flex items-center gap-3 mt-4">
        <div className="h-10 bg-[var(--bg-secondary)] rounded-xl flex-1" />
        <div className="h-10 bg-[var(--bg-secondary)] rounded-xl flex-1" />
      </div>
    </div>
  )
}
