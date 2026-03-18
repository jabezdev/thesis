type SparklineProps = {
  values: Array<number | null>;
  stroke?: string;
};

export function Sparkline({ values, stroke = "#0ea5e9" }: SparklineProps) {
  const cleaned = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  if (cleaned.length < 2) {
    return <div className="h-20 rounded-xl bg-slate-900/50" />;
  }

  const min = Math.min(...cleaned);
  const max = Math.max(...cleaned);
  const span = Math.max(1e-6, max - min);

  const points = cleaned
    .map((value, idx) => {
      const x = (idx / (cleaned.length - 1)) * 100;
      const y = 100 - ((value - min) / span) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="h-20 w-full rounded-xl bg-slate-900/50 p-2" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" points={points} />
    </svg>
  );
}
