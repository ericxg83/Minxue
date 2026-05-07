import TaskCardSkeleton from './TaskCardSkeleton'
import QuestionCardSkeleton from './QuestionCardSkeleton'
import ExamCardSkeleton from './ExamCardSkeleton'
import FilterTabsSkeleton from './FilterTabsSkeleton'

export function ProcessingSkeleton() {
  return (
    <div className="w-full">
      <FilterTabsSkeleton count={5} />
      <section className="px-5 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <TaskCardSkeleton key={i} />
        ))}
      </section>
    </div>
  )
}

export function PendingSkeleton() {
  return (
    <div className="w-full">
      <FilterTabsSkeleton count={3} />
      <section className="px-5 mb-4">
        <div className="h-5 bg-gray-200 rounded w-24 animate-pulse" />
      </section>
      <section className="px-5 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <QuestionCardSkeleton key={i} />
        ))}
      </section>
    </div>
  )
}

export function WrongBookSkeleton() {
  return (
    <div className="w-full">
      <FilterTabsSkeleton count={2} />
      <section className="px-5 mb-4">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 bg-gray-200 rounded-full w-16 animate-pulse" />
          ))}
        </div>
      </section>
      <section className="px-5 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <QuestionCardSkeleton key={i} />
        ))}
      </section>
    </div>
  )
}

export function ExamSkeleton() {
  return (
    <div className="w-full">
      <FilterTabsSkeleton count={3} />
      <section className="px-5 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <ExamCardSkeleton key={i} />
        ))}
      </section>
    </div>
  )
}

export {
  TaskCardSkeleton,
  QuestionCardSkeleton,
  ExamCardSkeleton,
  FilterTabsSkeleton
}
