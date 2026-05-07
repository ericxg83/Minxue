export default function TaskCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 animate-pulse">
      <div className="flex gap-3">
        <div className="w-20 h-20 rounded-xl bg-gray-200 flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between">
            <div className="h-4 bg-gray-200 rounded w-3/4" />
            <div className="w-8 h-8 rounded-full bg-gray-200" />
          </div>
          <div className="h-3 bg-gray-200 rounded w-1/3" />
          <div className="flex items-center gap-2 mt-2">
            <div className="h-5 bg-gray-200 rounded-full w-16" />
            <div className="h-4 bg-gray-200 rounded w-12" />
          </div>
        </div>
      </div>
    </div>
  )
}
