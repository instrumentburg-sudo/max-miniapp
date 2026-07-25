import type { ReactNode } from 'react';

/** Строка талона: подпись — пунктирная выноска — значение. */
export function TicketRow({
  label,
  children,
  price = false,
}: {
  label: string;
  children: ReactNode;
  price?: boolean;
}) {
  return (
    <div className="ticket__row">
      <span className="ticket__label">{label}</span>
      <span className="ticket__leader" />
      <span className={`ticket__value${price ? ' ticket__value--price' : ''}`}>{children}</span>
    </div>
  );
}
