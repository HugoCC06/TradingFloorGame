import { useState } from 'react';
import { getSettings } from '../../app/settings';
import { DIFFICULTIES, type DifficultyId } from '../../config/difficulty';
import { PRESETS, type PresetId } from '../../config/presets';
import { randomSeed } from '../../game/rng';
import type { GameSetup } from '../../game/types';
import { FundLogo, LOGO_COLORS, LOGO_MARKS } from '../../ui/components';
import { money } from '../../ui/format';

const NAME_IDEAS = ['Northbank Capital', 'Halberd Partners', 'Quayside Asset Management', 'Lantern Rock Capital', 'Copperline Partners', 'Westfold Investments', 'Bellwether Ridge', 'Silverkite Capital'];

export function NewGame({ onStart, onBack }: { onStart: (s: GameSetup) => Promise<void>; onBack: () => void }) {
  const [name, setName] = useState(NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)]);
  const [desc, setDesc] = useState('');
  const [mark, setMark] = useState<string>('TF');
  const [color, setColor] = useState(LOGO_COLORS[0]);
  const [accent, setAccent] = useState('#ffffff');
  const [difficulty, setDifficulty] = useState<DifficultyId>('normal');
  const [preset, setPreset] = useState<PresetId>('founder');
  const [tutorial, setTutorial] = useState(getSettings().tutorial);
  const [seedText, setSeedText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const valid = name.trim().length >= 2 && name.trim().length <= 40;
  const start = async () => {
    if (!valid) return;
    setBusy(true);
    setErr('');
    // let the button state paint before the (synchronous) world generation
    await new Promise((r) => setTimeout(r, 30));
    try {
      const seed = seedText.trim() ? (Number.isFinite(Number(seedText)) ? Number(seedText) >>> 0 : [...seedText].reduce((a, ch) => (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0, 7)) : randomSeed();
      await onStart({ fundName: name.trim(), description: desc.trim(), logo: { mark, color, accent }, difficulty, preset, tutorial, seed });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="setup">
      <button className="btn ghost sm" onClick={onBack}>← Main menu</button>
      <h1 style={{ fontSize: 28, margin: '12px 0 4px' }}>Found your fund</h1>
      <p className="muted">Choose an identity, a difficulty and your starting position. Branding is cosmetic; difficulty and starting conditions change the simulation.</p>

      <section className="card mt">
        <h2 className="mb">1 · Identity</h2>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
          <div className="col">
            <div className="field"><label htmlFor="fn">Fund name</label><input id="fn" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-testid="fund-name" />{!valid && <span className="small neg">Name must be 2–40 characters.</span>}</div>
            <div className="field"><label htmlFor="fd">Short description (optional)</label><input id="fd" className="input" value={desc} maxLength={120} placeholder="e.g. Long/short equity with a value tilt" onChange={(e) => setDesc(e.target.value)} /></div>
          </div>
          <div className="col">
            <div className="label">Logo</div>
            <div className="row wrap">{LOGO_MARKS.map((m) => <button key={m} className={`btn icon ${mark === m ? 'active' : ''}`} style={{ width: 42, height: 42, padding: 0 }} onClick={() => setMark(m)} aria-label={`Logo style ${m}`}><FundLogo logo={{ mark: m, color, accent }} name={name} size={32} /></button>)}</div>
            <div className="label">Colour</div>
            <div className="row wrap">{LOGO_COLORS.map((c) => <button key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Colour ${c}`} />)}</div>
            <div className="label">Accent</div>
            <div className="row wrap">{['#ffffff', '#0b0d10', '#f2b33d', '#e8ebef'].map((c) => <button key={c} className={`swatch ${accent === c ? 'on' : ''}`} style={{ background: c, border: '1px solid var(--border-2)' }} onClick={() => setAccent(c)} aria-label={`Accent ${c}`} />)}</div>
          </div>
        </div>
      </section>

      <section className="card mt">
        <h2 className="mb">2 · Difficulty</h2>
        <div className="grid g3">
          {(Object.keys(DIFFICULTIES) as DifficultyId[]).map((d) => {
            const def = DIFFICULTIES[d];
            return (
              <button key={d} className={`choice ${difficulty === d ? 'on' : ''}`} onClick={() => setDifficulty(d)} aria-pressed={difficulty === d} data-testid={`difficulty-${d}`}>
                <b>{def.name}</b>
                <span className="small muted">{def.blurb}</span>
                <span className="small dim">Volatility ×{def.volMult} · max leverage {Math.round(def.maxGross * 100)}% · collapse at −{Math.round(def.collapseDrawdown * 100)}%{def.crises ? ' · crises enabled' : ''}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card mt">
        <h2 className="mb">3 · Starting conditions</h2>
        <div className="grid g3">
          {(Object.keys(PRESETS) as PresetId[]).map((p) => {
            const def = PRESETS[p];
            return (
              <button key={p} className={`choice ${preset === p ? 'on' : ''}`} onClick={() => setPreset(p)} aria-pressed={preset === p}>
                <b>{def.name}</b>
                <span className="small muted">{def.blurb}</span>
                <span className="small dim">Fund {money((def.clientCapital + def.founderSeed) * 100, { compact: true })} · {def.clientCount} clients · company cash {money(def.companyCash * 100, { compact: true })} · {def.startingStaff.length} staff</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card mt">
        <h2 className="mb">4 · Options</h2>
        <label className="row"><input type="checkbox" checked={tutorial} onChange={(e) => setTutorial(e.target.checked)} /> Guided first session (skippable)</label>
        <div className="field mt" style={{ maxWidth: 320 }}><label htmlFor="seed">World seed (optional — share it to replay the same market)</label><input id="seed" className="input" placeholder="Random" value={seedText} onChange={(e) => setSeedText(e.target.value)} /></div>
      </section>

      {err && <div className="banner danger mt">{err}</div>}
      <div className="row mt" style={{ justifyContent: 'flex-end' }}>
        <button className="btn lg" onClick={onBack}>Cancel</button>
        <button className="btn primary lg" disabled={!valid || busy} onClick={start} data-testid="start-game">{busy ? 'Generating market…' : 'Open the fund ▸'}</button>
      </div>
    </div>
  );
}
