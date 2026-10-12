import { useState } from 'react';
import { resetSettings, SPEEDS, updateSettings, type Settings as S } from '../../app/settings';
import { useSettings } from '../../app/store';
import { play } from '../../app/audio';
import { Confirm, Panel } from '../../ui/components';

function Toggle({ k, label, hint }: { k: keyof S; label: string; hint?: string }) {
  const s = useSettings();
  return (
    <label className="row" style={{ alignItems: 'flex-start', gap: 10, padding: '6px 0' }}>
      <input type="checkbox" checked={Boolean(s[k])} onChange={(e) => updateSettings({ [k]: e.target.checked } as Partial<S>)} />
      <span><span>{label}</span>{hint && <div className="small dim">{hint}</div>}</span>
    </label>
  );
}

export function SettingsView() {
  const s = useSettings();
  const [reset, setReset] = useState(false);
  return (
    <div>
      <div className="page-h"><div><h1>Settings</h1><div className="sub">Preferences are stored in this browser.</div></div><button className="btn" onClick={() => setReset(true)}>Reset to defaults</button></div>
      <div className="grid g2">
        <Panel title="Simulation">
          <div className="field mb"><label htmlFor="sp">Default speed</label>
            <select id="sp" className="input" value={s.speed} onChange={(e) => updateSettings({ speed: e.target.value as S['speed'] })}>
              {Object.entries(SPEEDS).map(([k, v]) => <option key={k} value={k}>{v.label} — {(v.msPerMinute * 390 / 60000).toFixed(1)} real minutes per trading day</option>)}
            </select></div>
          <Toggle k="pauseOnClose" label="Pause at the close and show the daily report" hint="Turn off to roll straight into the next session." />
          <Toggle k="pauseOnBreaking" label="Pause on breaking news" />
          <Toggle k="pauseWhenHidden" label="Pause when the tab is hidden" />
          <div className="field mt"><label htmlFor="as">Autosave</label>
            <select id="as" className="input" value={s.autosave} onChange={(e) => updateSettings({ autosave: e.target.value as S['autosave'] })}>
              <option value="frequent">Every simulated hour and at each close</option><option value="daily">At each close only</option><option value="off">Off (manual saves only)</option>
            </select></div>
        </Panel>
        <Panel title="Audio">
          <Toggle k="muted" label="Mute everything" />
          <div className="field mt"><label htmlFor="sfx">Sound effects volume</label><input id="sfx" type="range" min={0} max={1} step={0.05} value={s.sfxVolume} onChange={(e) => updateSettings({ sfxVolume: Number(e.target.value) })} onMouseUp={() => play('order')} /></div>
          <Toggle k="musicOn" label="Ambient music" hint="A quiet generative soundtrack." />
          <div className="field"><label htmlFor="mus">Music volume</label><input id="mus" type="range" min={0} max={1} step={0.05} value={s.musicVolume} onChange={(e) => updateSettings({ musicVolume: Number(e.target.value) })} /></div>
        </Panel>
        <Panel title="Display & accessibility">
          <div className="field mb"><label htmlFor="th">Theme</label>
            <select id="th" className="input" value={s.theme} onChange={(e) => updateSettings({ theme: e.target.value as S['theme'] })}><option value="dark">Dark</option><option value="light">Light</option></select></div>
          <Toggle k="largeText" label="Larger text" />
          <Toggle k="reduceMotion" label="Reduce motion" hint="Disables the ticker tape scroll and transitions." />
        </Panel>
        <Panel title="Charts & notifications">
          <div className="field mb"><label htmlFor="cs">Chart style</label>
            <select id="cs" className="input" value={s.chartStyle} onChange={(e) => updateSettings({ chartStyle: e.target.value as S['chartStyle'] })}><option value="candles">Candlesticks</option><option value="line">Line</option></select></div>
          <div className="field mb"><label htmlFor="tf">Default timeframe</label>
            <select id="tf" className="input" value={s.defaultTimeframe} onChange={(e) => updateSettings({ defaultTimeframe: e.target.value as S['defaultTimeframe'] })}>{['1m', '5m', '15m', '1h', '1D'].map((t) => <option key={t}>{t}</option>)}</select></div>
          <Toggle k="showVolume" label="Show volume bars" />
          <Toggle k="toasts" label="Show pop-up notifications" />
          <div className="field"><label htmlFor="nt">News pop-ups</label>
            <select id="nt" className="input" value={s.newsToasts} onChange={(e) => updateSettings({ newsToasts: e.target.value as S['newsToasts'] })}><option value="all">All major news</option><option value="holdings">Holdings & breaking only</option><option value="off">Off</option></select></div>
          <Toggle k="tutorial" label="Offer the tutorial for new games" />
        </Panel>
      </div>
      {reset && <Confirm title="Reset settings?" text="All preferences return to defaults. Saves are not affected." onCancel={() => setReset(false)} onConfirm={() => { resetSettings(); setReset(false); }} />}
    </div>
  );
}
