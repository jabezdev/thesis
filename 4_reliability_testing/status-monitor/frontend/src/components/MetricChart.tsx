import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface MetricChartProps<T extends { label: string }> {
  title: string;
  subtitle: string;
  data: T[];
  valueKey: Extract<keyof T, string>;
  accent: string;
  unit: string;
}

function formatValue(value: unknown, unit: string) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }

  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
  return `${rounded}${unit}`;
}

export function MetricChart<T extends { label: string }>({ title, subtitle, data, valueKey, accent, unit }: MetricChartProps<T>) {
  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>

      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`${valueKey}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={accent} stopOpacity={0.35} />
                <stop offset="95%" stopColor={accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148, 163, 184, 0.16)" strokeDasharray="4 6" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#bfd4ea', fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: '#bfd4ea', fontSize: 12 }} width={36} />
            <Tooltip
              contentStyle={{
                background: 'rgba(7, 17, 30, 0.95)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: 16,
                color: '#eff6ff',
              }}
              labelStyle={{ color: '#9bd3ff' }}
              formatter={(value: unknown) => formatValue(value, unit)}
            />
            <Area
              type="monotone"
              dataKey={valueKey}
              stroke={accent}
              strokeWidth={2.5}
              fill={`url(#${valueKey}-fill)`}
              dot={{ r: 3, strokeWidth: 2, fill: '#08111c' }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
