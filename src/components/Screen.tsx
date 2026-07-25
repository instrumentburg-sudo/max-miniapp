import type { ReactNode } from 'react';

/**
 * Шапка внутреннего экрана: технический надзаголовок + крупный титул
 * на жирной линейке — «графа бланка», единая для всех страниц.
 */
export function Screen({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="page-enter">
      <header className="screen__head">
        <div className="screen__eyebrow">
          <i />
          {eyebrow}
        </div>
        <h1 className="screen__title">{title}</h1>
      </header>
      {children}
    </div>
  );
}
