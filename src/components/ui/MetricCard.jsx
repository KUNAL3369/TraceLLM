export default function MetricCard({ title, value, unit, trend, icon, color = "#344e41" }) {
  const isUp = trend > 0;
  return (
    <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-5 shadow-lg">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-400">{title}</span>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-extrabold text-white">{value}</span>
        <span className="text-sm text-gray-400">{unit}</span>
      </div>
      {trend !== undefined && (
        <div className={`mt-1 text-xs font-medium ${isUp ? "text-green-400" : "text-red-400"}`}>
          {isUp ? "↑" : "↓"} {Math.abs(trend)}%
        </div>
      )}
    </div>
  );
}
