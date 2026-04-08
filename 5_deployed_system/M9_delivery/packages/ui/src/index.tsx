import React from 'react';

/**
 * @panahonUI - Shared Components
 */

export function Card({
  children,
  className = '',
}: { children: React.ReactNode; className?: string }) {
  return (
  <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden ${className}`}>
    {children}
  </div>
  );
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' }) {
  const base = 'px-4 py-2 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50';
  const variants: Record<string, string> = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm',
    secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-white',
    outline: 'border border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800',
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Badge({
  children,
  variant = 'info',
  className = '',
}: { children: React.ReactNode; variant?: 'success' | 'warning' | 'error' | 'info'; className?: string }) {
  const colors: Record<string, string> = {
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    error: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
    info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[variant]} ${className}`}>
      {children}
    </span>
  );
}

export function Stats({
  label,
  value,
  unit = '',
  trend,
  className = '',
}: { label: string; value: string | number; unit?: string; trend?: string; className?: string }) {
  return (
  <div className={`p-4 ${className}`}>
    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
    <div className="flex items-baseline gap-1 mt-1">
      <h3 className="text-2xl font-bold tracking-tight">{value}</h3>
      <span className="text-xs text-slate-400">{unit}</span>
    </div>
    {trend && (
      <p className={`mt-1 text-xs font-medium ${trend.startsWith('+') ? 'text-emerald-500' : 'text-rose-500'}`}>
        {trend} from last hour
      </p>
    )}
  </div>
  );
}
