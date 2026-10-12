import { useEffect, useMemo, useState } from 'react';
import { controller } from '../../app/controller';
import { useTicketPrefill } from '../../app/selection';
import { instById, navCents } from '../../game/accounting';
import { currentQty, submitOrder, validateOrder, type OrderDraft } from '../../game/orders';
import type { GameState, OrderSide, OrderType } from '../../game/types';
import { money, num, price } from '../../ui/format';

export function OrderTicket({ state, instrumentId, compact }: { state: GameState; instrumentId: string; compact?: boolean }) {
  const inst = instById(state, instrumentId);
  const held = currentQty(state, instrumentId);
  const [side, setSide] = useState<OrderSide>(held < 0 ? 'cover' : 'buy');
  const [type, setType] = useState<OrderType>('market');
  const [qtyText, setQtyText] = useState('');
  const [px, setPx] = useState('');
  const [tif, setTif] = useState<'day' | 'gtc'>('day');
  const prefill = useTicketPrefill();

  useEffect(() => {
    setQtyText('');
    setPx('');
    setType('market');
    const q = currentQty(state, instrumentId);
    setSide(q < 0 ? 'cover' : 'buy');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentId]);

  useEffect(() => {
    if (prefill && prefill.instrument === instrumentId) {
      setSide(prefill.side);
      if (prefill.quantity) setQtyText(String(prefill.quantity));
    }
  }, [prefill, instrumentId]);

  const qty = Math.floor(Number(qtyText.replace(/,/g, '')));
  const draft: OrderDraft = useMemo(() => ({
    instrument: instrumentId, side, type, quantity: qtyText ? qty : 0, tif,
    limitPrice: type === 'limit' ? Number(px) : undefined, stopPrice: type === 'stop' ? Number(px) : undefined,
  }), [instrumentId, side, type, qty, qtyText, px, tif]);
  const check = validateOrder(state, draft);
  if (!inst) return <div className="empty">Select an instrument</div>;

  const nav = navCents(state);
  const setPctNav = (p: number) => setQtyText(String(Math.max(1, Math.floor((nav * p) / 100 / inst.price))));
  const closeAll = () => setQtyText(String(Math.abs(held)));
  const submit = () => {
    if (!qtyText) return;
    controller.act((s) => submitOrder(s, draft));
    setQtyText('');
  };
  const sides: OrderSide[] = ['buy', 'sell', 'short', 'cover'];
  const showErrors = qtyText !== '' || (type !== 'market' && px !== '');

  return (
    <div className="col" style={{ gap: 10 }} data-testid="order-ticket">
      <div className="order-side" role="group" aria-label="Order side">
        {sides.map((s) => (
          <button key={s} type="button" className={`${s} ${side === s ? 'on' : ''}`} aria-pressed={side === s} onClick={() => setSide(s)}
            disabled={(s === 'short' && !inst.shortable)} title={s === 'short' && !inst.shortable ? 'Not available to borrow' : undefined}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <div className="row">
        <div className="field grow">
          <label htmlFor="ot-type">Type</label>
          <select id="ot-type" className="input" value={type} onChange={(e) => setType(e.target.value as OrderType)}>
            <option value="market">Market</option>
            <option value="limit">Limit</option>
            <option value="stop">Stop</option>
          </select>
        </div>
        <div className="field grow">
          <label htmlFor="ot-qty">Quantity</label>
          <input id="ot-qty" className="input num" inputMode="numeric" placeholder="0" value={qtyText} onChange={(e) => setQtyText(e.target.value.replace(/[^0-9,]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter' && check.ok) submit(); }} />
        </div>
      </div>
      {type !== 'market' && (
        <div className="row">
          <div className="field grow">
            <label htmlFor="ot-px">{type === 'limit' ? 'Limit price' : 'Stop price'}</label>
            <input id="ot-px" className="input num" inputMode="decimal" placeholder={price(inst.price)} value={px} onChange={(e) => setPx(e.target.value.replace(/[^0-9.]/g, ''))} />
          </div>
          <div className="field grow">
            <label htmlFor="ot-tif">Time in force</label>
            <select id="ot-tif" className="input" value={tif} onChange={(e) => setTif(e.target.value as 'day' | 'gtc')}>
              <option value="day">Day</option>
              <option value="gtc">Good till cancelled</option>
            </select>
          </div>
        </div>
      )}
      <div className="row wrap" style={{ gap: 4 }}>
        {[0.01, 0.025, 0.05, 0.1].map((p) => <button key={p} className="btn sm" type="button" onClick={() => setPctNav(p)} title={`Size to ${p * 100}% of NAV`}>{p * 100}%</button>)}
        {held !== 0 && <button className="btn sm" type="button" onClick={() => { setSide(held > 0 ? 'sell' : 'cover'); closeAll(); }}>Close {num(Math.abs(held))}</button>}
      </div>
      {!compact && (
        <div className="kv">
          <span>Position</span><span className={held > 0 ? 'pos' : held < 0 ? 'neg' : ''}>{held === 0 ? '—' : `${held > 0 ? 'Long' : 'Short'} ${num(Math.abs(held))}`}</span>
          <span>{type === 'limit' ? 'Limit (worst price)' : 'Est. fill price'}</span><span>{qtyText ? price(check.estPrice) : '—'}</span>
          <span>Est. notional</span><span>{qtyText ? money(check.estNotional) : '—'}</span>
          <span>Commission</span><span>{qtyText ? money(check.estCommission, { decimals: 2 }) : '—'}</span>
          <span>Spread + impact</span><span>{qtyText && type !== 'limit' ? money(check.estCost, { decimals: 2 }) : '—'}</span>
          {check.post && <><span>Position after</span><span>{(check.post.positionWeight * 100).toFixed(1)}% NAV</span>
            <span>Gross after</span><span>{(check.post.grossLeverage * 100).toFixed(0)}% NAV</span>
            <span>Margin use after</span><span className={check.post.marginUtilisation > 0.8 ? 'warn' : ''}>{(check.post.marginUtilisation * 100).toFixed(0)}%</span></>}
          <span>Max order size</span><span>{num(check.maxQty)}</span>
        </div>
      )}
      {showErrors && check.errors.map((e) => <div key={e} className="small neg" role="alert">✕ {e}</div>)}
      {showErrors && check.warnings.map((w) => <div key={w} className="small warn">! {w}</div>)}
      <button className={`btn lg ${side === 'buy' || side === 'cover' ? 'buy' : 'sell'}`} disabled={!qtyText || !check.ok} onClick={submit} data-testid="submit-order">
        {side.toUpperCase()} {qtyText ? num(qty) : ''} {inst.id} {type !== 'market' ? `@ ${px || '…'}` : ''}
      </button>
      {state.clock.phase !== 'open' && <div className="small dim">Market closed — orders queue for the next session.</div>}
    </div>
  );
}
