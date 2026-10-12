// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { controller } from '../../app/controller';
import { fresh } from '../../game/__tests__/helpers';
import { OrderTicket } from '../orders/OrderTicket';

describe('OrderTicket UI', () => {
  test('validates input, shows estimates and submits a real order to the engine', () => {
    const g = fresh({ seed: 8 });
    controller.state = g;
    const inst = g.instruments.find((i) => i.kind === 'equity' && i.shortable)!;
    const { rerender } = render(<OrderTicket state={g} instrumentId={inst.id} />);
    const submit = screen.getByTestId('submit-order') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // selling with no position is explained and blocked
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '100' } });
    expect(screen.getByRole('alert').textContent).toMatch(/no long position/);
    expect((screen.getByTestId('submit-order') as HTMLButtonElement).disabled).toBe(true);
    // a valid buy
    fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
    expect(screen.getByText('Est. notional').nextSibling!.textContent).toMatch(/\$/);
    act(() => { fireEvent.click(screen.getByTestId('submit-order')); });
    rerender(<OrderTicket state={g} instrumentId={inst.id} />);
    const order = g.orders.at(-1)!;
    expect(order.instrument).toBe(inst.id);
    expect(order.quantity).toBe(100);
    expect(order.status).toBe('open'); // pre-market: queued for the open
    controller.state = null;
  });
});
