import { useEffect, useRef } from 'react';
import { BrandMark } from '../../ui/components';

/** Short, skippable title sequence: drifting price lines behind fading typography. */
export function Intro({ onDone }: { onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const t = setTimeout(onDone, 6500);
    const key = () => onDone();
    window.addEventListener('keydown', key);
    const c = canvas.current;
    let raf = 0;
    if (c) {
      const ctx = c.getContext('2d')!;
      const resize = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
      resize();
      const lines = Array.from({ length: 14 }, (_, i) => ({ y: (i + 0.5) / 14, pts: [] as number[], v: 0, col: i % 3 === 0 ? '#2ebd85' : i % 3 === 1 ? '#4c8dff' : '#f0565b' }));
      let x = 0;
      const draw = () => {
        ctx.fillStyle = 'rgba(7,9,12,0.12)';
        ctx.fillRect(0, 0, c.width, c.height);
        x += 3;
        for (const l of lines) {
          l.v += (Math.random() - 0.5) * 3;
          l.v *= 0.96;
          const last = l.pts.length ? l.pts[l.pts.length - 1] : 0;
          l.pts.push(last + l.v);
          if (l.pts.length > 2) {
            ctx.strokeStyle = l.col;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            const n = l.pts.length;
            ctx.moveTo((x - 3) % c.width, l.y * c.height + l.pts[n - 2]);
            ctx.lineTo(x % c.width, l.y * c.height + l.pts[n - 1]);
            ctx.stroke();
          }
        }
        raf = requestAnimationFrame(draw);
      };
      draw();
      window.addEventListener('resize', resize);
    }
    return () => { clearTimeout(t); window.removeEventListener('keydown', key); cancelAnimationFrame(raf); };
  }, [onDone]);
  return (
    <div className="intro" onClick={onDone} role="dialog" aria-label="Introduction">
      <canvas ref={canvas} aria-hidden />
      <div className="line" style={{ animationDelay: '0.2s', position: 'relative' }}>Every great firm starts with a single trade.</div>
      <div className="line" style={{ animationDelay: '1.4s', position: 'relative' }}>Raise capital. Read the market. Manage the risk. Outlast your rivals.</div>
      <div className="line" style={{ animationDelay: '2.8s', position: 'relative', display: 'flex', alignItems: 'center', gap: 14, color: '#fff', fontSize: 40, fontWeight: 700, letterSpacing: '-0.03em' }}>
        <BrandMark size={52} /> Trading<span style={{ color: '#4c8dff', marginLeft: -12 }}>Floor</span>
      </div>
      <button className="btn ghost" style={{ position: 'absolute', bottom: 24, right: 24, color: '#a3abb5' }} onClick={onDone}>Skip ▸</button>
    </div>
  );
}
