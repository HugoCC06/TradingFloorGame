import { useEffect, useRef, useState } from 'react';
import {
  AreaSeries, CandlestickSeries, ColorType, createChart, CrosshairMode, HistogramSeries, LineSeries,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts';
import type { GameState } from '../game/types';
import { aggregate, sessionStart, toBars, type Bar } from '../game/series';
import { useSettings } from '../app/store';
import { price as fmtPrice, pct } from './format';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1D';
export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '1D'];

/** All timeframes are views of the same underlying simulated history. */
export function chartBars(state: GameState, idx: number, tf: Timeframe): Bar[] {
  const H = state.history;
  switch (tf) {
    case '1m': return toBars(H.m1[idx]);
    case '5m': return aggregate(toBars(H.m1[idx]), 300, sessionStart);
    case '15m': return toBars(H.m15[idx]);
    case '1h': return toBars(H.h1[idx]);
    case '1D': return toBars(H.d1[idx]);
  }
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function baseChart(el: HTMLElement, tf: Timeframe | 'line'): IChartApi {
  return createChart(el, {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: cssVar('--panel') }, textColor: cssVar('--text-2'), fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11, attributionLogo: false },
    grid: { vertLines: { color: cssVar('--border') }, horzLines: { color: cssVar('--border') } },
    rightPriceScale: { borderColor: cssVar('--border') },
    timeScale: { borderColor: cssVar('--border'), timeVisible: tf !== '1D' && tf !== 'line', secondsVisible: false, rightOffset: 4 },
    crosshair: { mode: CrosshairMode.Normal },
    handleScale: { axisPressedMouseMove: true },
    localization: { locale: 'en-US' },
  });
}

interface Legend { o: number; h: number; l: number; c: number; v: number; chg: number }

export function CandleChart({ state, idx, tf, height = 340, version }: { state: GameState; idx: number; tf: Timeframe; height?: number; version: number }) {
  const settings = useSettings();
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const main = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null);
  const vol = useRef<ISeriesApi<'Histogram'> | null>(null);
  const meta = useRef<{ idx: number; tf: Timeframe; len: number; lastTime: number }>({ idx: -1, tf, len: 0, lastTime: 0 });
  const [legend, setLegend] = useState<Legend | null>(null);
  const lastBars = useRef<Bar[]>([]);

  // (re)create chart when style/theme changes
  useEffect(() => {
    if (!el.current) return;
    const c = baseChart(el.current, tf);
    chart.current = c;
    const up = cssVar('--pos'), down = cssVar('--neg');
    main.current = settings.chartStyle === 'candles'
      ? c.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } })
      : c.addSeries(LineSeries, { color: cssVar('--accent'), lineWidth: 2, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
    if (settings.showVolume) {
      vol.current = c.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
      c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      main.current.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    } else vol.current = null;
    meta.current = { idx: -1, tf, len: 0, lastTime: 0 };
    c.subscribeCrosshairMove((p) => {
      if (!p.time) { setLegend(null); return; }
      const b = lastBars.current.find((x) => x.time === p.time);
      if (b) setLegend({ o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, chg: b.close / b.open - 1 });
    });
    return () => { c.remove(); chart.current = null; main.current = null; vol.current = null; };
  }, [settings.chartStyle, settings.showVolume, settings.theme, tf]);

  // feed data from the simulation
  useEffect(() => {
    const c = chart.current, s = main.current;
    if (!c || !s) return;
    const bars = chartBars(state, idx, tf);
    lastBars.current = bars;
    const up = cssVar('--pos'), down = cssVar('--neg');
    const toMain = (b: Bar) => (settings.chartStyle === 'candles'
      ? { time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close }
      : { time: b.time as UTCTimestamp, value: b.close });
    const toVol = (b: Bar) => ({ time: b.time as UTCTimestamp, value: b.volume, color: b.close >= b.open ? up + '55' : down + '55' });
    const m = meta.current;
    const last = bars[bars.length - 1];
    const incremental = m.idx === idx && m.tf === tf && last && (bars.length === m.len || bars.length === m.len + 1) && last.time >= m.lastTime;
    if (incremental && last) {
      if (bars.length === m.len + 1 && bars.length > 1) {
        (s as ISeriesApi<'Line'>).update(toMain(bars[bars.length - 2]) as never);
        vol.current?.update(toVol(bars[bars.length - 2]));
      }
      (s as ISeriesApi<'Line'>).update(toMain(last) as never);
      vol.current?.update(toVol(last));
    } else {
      (s as ISeriesApi<'Line'>).setData(bars.map(toMain) as never);
      vol.current?.setData(bars.map(toVol));
      if (m.idx !== idx || m.tf !== tf) {
        const n = bars.length;
        const show = tf === '1D' ? 130 : tf === '1h' ? 70 : tf === '15m' ? 104 : tf === '5m' ? 120 : 160;
        if (n > show) c.timeScale().setVisibleLogicalRange({ from: n - show, to: n + 3 });
        else c.timeScale().fitContent();
      }
    }
    meta.current = { idx, tf, len: bars.length, lastTime: last?.time ?? 0 };
  }, [state, idx, tf, version, settings.chartStyle]);

  return (
    <div className="chart-box" style={{ height }}>
      <div className="chart-legend num">
        {legend ? (<>
          <span>O {fmtPrice(legend.o)}</span><span>H {fmtPrice(legend.h)}</span><span>L {fmtPrice(legend.l)}</span><span>C {fmtPrice(legend.c)}</span>
          <span className={legend.chg >= 0 ? 'pos' : 'neg'}>{pct(legend.chg)}</span><span>Vol {Math.round(legend.v).toLocaleString('en-US')}</span>
        </>) : <span className="dim">Hover for OHLC · scroll to zoom · drag to pan</span>}
      </div>
      <div ref={el} style={{ position: 'absolute', inset: 0 }} data-testid="candle-chart" />
    </div>
  );
}

export interface LinePoint { time: number; value: number }

/** Multi-line performance chart (e.g. fund NAV/unit vs benchmark, rebased to 100). */
export function PerfChart({ series, height = 260, version, area }: { series: { name: string; color: string; points: LinePoint[] }[]; height?: number; version: number; area?: boolean }) {
  const settings = useSettings();
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const lines = useRef<ISeriesApi<'Line' | 'Area'>[]>([]);
  const count = series.length;
  useEffect(() => {
    if (!el.current) return;
    const c = baseChart(el.current, 'line');
    chart.current = c;
    lines.current = series.map((s, i) => (area && i === 0
      ? c.addSeries(AreaSeries, { lineColor: s.color, topColor: s.color + '40', bottomColor: s.color + '05', lineWidth: 2, priceLineVisible: false })
      : c.addSeries(LineSeries, { color: s.color, lineWidth: 2, priceLineVisible: false })));
    return () => { c.remove(); chart.current = null; lines.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.theme, count, area]);
  useEffect(() => {
    series.forEach((s, i) => {
      const l = lines.current[i];
      if (!l) return;
      // dedupe & sort times (required by the library)
      const seen = new Map<number, number>();
      for (const p of s.points) seen.set(p.time, p.value);
      const pts = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ time: t as UTCTimestamp, value: v }));
      l.setData(pts);
    });
    const c = chart.current;
    c?.timeScale().fitContent();
    // the auto-sized container may not have its final width yet on first paint
    const raf = requestAnimationFrame(() => c?.timeScale().fitContent());
    const t = setTimeout(() => { try { c?.timeScale().fitContent(); } catch { /* chart removed */ } }, 120);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, series.map((s) => s.points.length).join(',')]);
  return (
    <div className="chart-box" style={{ height }}>
      <div className="chart-legend">
        {series.map((s) => <span key={s.name}><span className="dot" style={{ background: s.color, marginRight: 4 }} />{s.name}</span>)}
      </div>
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}
