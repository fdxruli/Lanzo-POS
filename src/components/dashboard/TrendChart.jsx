// src/components/dashboard/TrendChart.jsx
import React, { useId, useMemo } from 'react';
import {
  AreaChart,
  Area,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { TrendingUp, TrendingDown } from 'lucide-react';
import './TrendChart.css';

// Extraemos formatCurrency fuera para que no se recree en cada render
const formatCurrency = (value) => {
  const numValue = Number(value) || 0;
  if (numValue >= 1000) {
    return `$${(numValue / 1000).toFixed(1)}k`;
  }
  return `$${numValue.toFixed(0)}`;
};

const defaultValueFormatter = formatCurrency;

// Extraemos CustomTooltip a nivel de módulo para evitar el error de "components created during render"
const CustomTooltip = ({ active, payload, formatter = defaultValueFormatter }) => {
  if (active && payload && payload.length && payload[0]) {
    const dataPoint = payload[0].payload;
    const label = dataPoint?.name ?? 'N/A';
    const value = dataPoint?.value ?? 0;
    return (
      <div className="custom-tooltip">
        <p className="tooltip-label">{label}</p>
        <p className="tooltip-value">{formatter(value)}</p>
      </div>
    );
  }
  return null;
};

class ChartErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, resetKey: props.resetKey };
    }

    return null;
  }

  render() {
    if (this.state.hasError) {
      return <ChartFallback height={this.props.height} />;
    }

    return this.props.children;
  }
}

const ChartFallback = ({ height = 180 }) => (
  <div className="chart-empty-state" style={{ minHeight: height }}>
    <p>No se pudo mostrar la grafica</p>
  </div>
);

/**
 * Gráfica de área con Recharts para evolución temporal
 */
export function AreaTrendChart({
  data,
  height = 200,
  color = 'var(--primary-color)',
  valueFormatter = defaultValueFormatter
}) {
  const gradientId = useId().replace(/:/g, '');

  // Validar y normalizar datos
  const normalizedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map(item => ({
      name: item?.name ?? 'N/A',
      value: Number(item?.value) || 0
    }));
  }, [data]);
  const resetKey = useMemo(
    () => normalizedData.map(item => `${item.name}:${item.value}`).join('|'),
    [normalizedData]
  );

  if (normalizedData.length === 0) {
    return <ChartFallback height={height} />;
  }

  return (
    <ChartErrorBoundary resetKey={resetKey} height={height}>
      <div className="recharts-container" style={{ minHeight: height }}>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={normalizedData}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" opacity={0.5} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
              axisLine={{ stroke: 'var(--border-color)' }}
              tickLine={{ stroke: 'var(--border-color)' }}
              minTickGap={10}
            />
            <YAxis
              tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={valueFormatter}
              width={60}
            />
            <Tooltip content={<CustomTooltip formatter={valueFormatter} />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fillOpacity={1}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartErrorBoundary>
  );
}

/**
 * Gráfica de barras con Recharts para días de semana
 */
export function BarWeekdayChart({ data, height = 180, valueFormatter = defaultValueFormatter }) {
  // Validar y normalizar datos
  const normalizedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map(item => ({
      name: item?.name ?? 'N/A',
      value: Number(item?.value) || 0
    }));
  }, [data]);
  const resetKey = useMemo(
    () => normalizedData.map(item => `${item.name}:${item.value}`).join('|'),
    [normalizedData]
  );

  if (normalizedData.length === 0) {
    return <ChartFallback height={height} />;
  }

  return (
    <ChartErrorBoundary resetKey={resetKey} height={height}>
      <div className="recharts-container" style={{ minHeight: height }}>
        <ResponsiveContainer width="100%" height={height}>
          <RechartsBarChart data={normalizedData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" opacity={0.5} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              axisLine={{ stroke: 'var(--border-color)' }}
              tickLine={{ stroke: 'var(--border-color)' }}
            />
            <YAxis
              tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={valueFormatter}
              width={60}
            />
            <Tooltip content={<CustomTooltip formatter={valueFormatter} />} />
            <Bar
              dataKey="value"
              fill="var(--primary-color)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </ChartErrorBoundary>
  );
}

/**
 * Mini gráfica de línea SVG simple (sin Recharts) para tarjetas
 */
export function MiniLineChart({ data, color = 'var(--primary-color)', height = 60 }) {
  if (!data || data.length < 2) return null;

  const validData = data.filter(v => typeof v === 'number' && !isNaN(v));
  if (validData.length < 2) return null;
  const maxValue = Math.max(...validData, 1);
  const minValue = Math.min(...data, 0);
  const range = maxValue - minValue || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = height - ((value - minValue) / range) * (height - 10) - 5;
    return `${x},${y}`;
  }).join(' ');

  const areaPoints = `0,${height} ${points} 100,${height}`;
  const isPositive = data[data.length - 1] >= data[0];

  return (
    <div className="mini-line-chart-container" style={{ height }}>
      <svg viewBox={`0 0 100 ${height}`} className="mini-line-chart-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`gradient-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill={`url(#gradient-${color})`} />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={height * 0.05}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className={`mini-chart-indicator ${isPositive ? 'positive' : 'negative'}`}>
        {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      </div>
    </div>
  );
}

/**
 * Heatmap visual para días de la semana (versión SVG ligera)
 */
export function WeekdayHeatmap({ dayData }) {
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const values = days.map((_, i) => dayData[i] || 0);
  const maxValue = Math.max(...values, 1);

  const getIntensity = (value) => {
    const ratio = value / maxValue;
    if (ratio === 0) return 'var(--border-color)';
    if (ratio < 0.25) return 'rgba(99, 102, 241, 0.3)';
    if (ratio < 0.5) return 'rgba(99, 102, 241, 0.5)';
    if (ratio < 0.75) return 'rgba(99, 102, 241, 0.7)';
    return 'var(--primary-color)';
  };

  return (
    <div className="weekday-heatmap">
      {days.map((day, i) => (
        <div key={day} className="weekday-cell">
          <span className="weekday-label">{day}</span>
          <div
            className="weekday-bar"
            style={{
              backgroundColor: getIntensity(values[i]),
              height: `${Math.max((values[i] / maxValue) * 60, 4)}px`
            }}
          />
          <span className="weekday-value">
            {values[i] >= 1000 ? `$${(values[i] / 1000).toFixed(1)}k` : `$${values[i].toFixed(0)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Tarjeta de métrica con indicador de tendencia
 */
export function MetricWithTrend({ label, value, trendValue, trendLabel, icon: Icon, formatValue }) {
  const isPositive = trendValue >= 0;
  const formattedValue = formatValue ? formatValue(value) : value;

  return (
    <div className="metric-trend-card">
      <div className="metric-trend-header">
        <span className="metric-trend-label">{label}</span>
        {Icon && <Icon size={18} className="metric-trend-icon" />}
      </div>
      <div className="metric-trend-value">{formattedValue}</div>
      {trendValue !== undefined && (
        <div className={`metric-trend-indicator ${isPositive ? 'positive' : 'negative'}`}>
          {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span>{Math.abs(trendValue).toFixed(1)}% {trendLabel}</span>
        </div>
      )}
    </div>
  );
}

export default { AreaTrendChart, BarWeekdayChart, MiniLineChart, WeekdayHeatmap, MetricWithTrend };
