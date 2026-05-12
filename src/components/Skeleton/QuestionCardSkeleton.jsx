export default function QuestionCardSkeleton() {
  return (
    <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 animate-pulse">
      <div className="flex gap-3">
        <div className="w-5 h-5 rounded-md bg-gray-200 flex-shrink-0 mt-1" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between">
            <div className="h-3 bg-gray-200 rounded w-16" />
            <div className="h-5 bg-gray-200 rounded-full w-14" />
          </div>
          <div className="h-4 bg-gray-200 rounded w-full" />
          <div className="h-4 bg-gray-200 rounded w-5/6" />
          <div className="space-y-1.5 mt-3">
            <div className="h-9 bg-gray-200 rounded-lg" />
            <div className="h-9 bg-gray-200 rounded-lg" />
            <div className="h-9 bg-gray-200 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
