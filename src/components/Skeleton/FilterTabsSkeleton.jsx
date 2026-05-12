export default function FilterTabsSkeleton({ count = 4 }) {
  return (
    <section className="px-4 pt-3 mb-2 overflow-x-auto no-scrollbar">
      <div className="flex gap-2 min-w-max">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="h-10 bg-gray-200 rounded-full animate-pulse"
            style={{ width: `${80 + Math.random() * 40}px` }}
          />
        ))}
      </div>
    </section>
  )
}
