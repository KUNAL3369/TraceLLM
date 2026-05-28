export function MetricCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-white/10 bg-[#1e293b] p-5">
      <div className="mb-2 h-4 w-20 rounded bg-[#0f172a]" />
      <div className="h-8 w-28 rounded bg-[#0f172a]" />
    </div>
  );
}

export function EmptyState({ icon = "📭", title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#1e293b]/50 px-6 py-16 text-center">
      <div className="mb-4 text-4xl">{icon}</div>
      <h3 className="mb-1 text-lg font-medium text-white">{title}</h3>
      {description && <p className="mb-4 max-w-md text-sm text-gray-500">{description}</p>}
      {action}
    </div>
  );
}
