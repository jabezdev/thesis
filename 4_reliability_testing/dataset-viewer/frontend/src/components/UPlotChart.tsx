import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const CHART_HEIGHT = 200;

interface UPlotChartProps {
  title: string;
  subtitle: string;
  accent: string;
  timestamps: number[];
  values: (number | null)[];
}

const GRID = { stroke: 'rgba(148,163,184,0.12)', dash: [4, 6] as [number, number] };
const TICKS = { stroke: 'rgba(148,163,184,0.12)', size: 4 };
const AXIS_FONT = '12px "Space Grotesk", system-ui, sans-serif';

function makeOpts(width: number, accent: string): uPlot.Options {
  return {
    width,
    height: CHART_HEIGHT,
    padding: [8, 8, 0, 0],
    scales: { x: { time: true } },
    axes: [
      {
        stroke: '#8fa6bd',
        font: AXIS_FONT,
        grid: GRID,
        ticks: TICKS,
      },
      {
        stroke: '#8fa6bd',
        font: AXIS_FONT,
        grid: GRID,
        ticks: TICKS,
        size: 58,
      },
    ],
    series: [
      {},
      {
        stroke: accent,
        fill: `${accent}22`,
        width: 2,
        spanGaps: true,
        points: { show: false },
      },
    ],
    legend: { show: false },
  };
}

function toSafe(values: (number | null)[]): number[] {
  return values.map((v) => (v == null ? NaN : v));
}

export function UPlotChart({ title, subtitle, accent, timestamps, values }: UPlotChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  // Create the uPlot instance once on mount
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const w = el.clientWidth || 640;
    const plot = new uPlot(makeOpts(w, accent), [timestamps, toSafe(values)] as unknown as uPlot.AlignedData, el);
    plotRef.current = plot;

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || !plotRef.current) return;
      const newW = Math.floor(rect.width);
      if (newW > 0 && newW !== plotRef.current.width) {
        plotRef.current.setSize({ width: newW, height: CHART_HEIGHT });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data whenever timestamps/values change
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    plot.setData([timestamps, toSafe(values)] as unknown as uPlot.AlignedData);
  }, [timestamps, values]);

  return (
    <section className="panel chart-panel">
      <div className="chart-heading">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="chart-wrap" ref={wrapRef} />
    </section>
  );
}
