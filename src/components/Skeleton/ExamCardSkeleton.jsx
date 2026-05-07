export default function ExamCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-200 rounded w-1/3" />
        </div>
        <div className="h-5 bg-gray-200 rounded-full w-14" />
      </div>
      <div className="flex items-center gap-3 mt-4">
        <div className="h-10 bg-gray-200 rounded-xl flex-1" />
        <div className="h-10 bg-gray-200 rounded-xl flex-1" />
      </div>
    </div>
  )
}
