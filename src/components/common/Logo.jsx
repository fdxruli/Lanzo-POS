import { useAppStore } from '../../store/useAppStore';
import wordmarkAssetUrl from '../../../brand/lanzo-wordmark.svg?url';
import LogoMark from './LogoMark';

export { LogoMark } from './LogoMark';

export default function Logo({
  className,
  style,
  vertical = false,
  showBusinessName = true,
  markOnly = false,
}) {
  const companyName = useAppStore((state) => state.companyProfile?.name);
  const rawName = companyName ? companyName.toUpperCase() : 'TU NEGOCIO';
  const maxChars = vertical ? 18 : 22;
  const displayBusinessName = rawName.length > maxChars
    ? `${rawName.substring(0, maxChars - (vertical ? 2 : 3))}${vertical ? '..' : '...'}`
    : rawName;

  if (markOnly) {
    return <LogoMark className={className} style={style} />;
  }

  const wordmark = (
    <img
      src={wordmarkAssetUrl}
      alt="Lanzo"
      className={className}
      style={style}
    />
  );

  if (!showBusinessName) return wordmark;

  return (
    <span
      className={`lanzo-logo${vertical ? ' lanzo-logo--vertical' : ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: vertical ? '6px' : '10px',
        flexDirection: vertical ? 'column' : 'row',
      }}
      aria-label={`Lanzo POS, ${rawName}`}
    >
      {wordmark}
      <span
        className="lanzo-logo__business-name"
        style={{
          color: 'var(--text-dark)',
          fontSize: vertical ? '0.78rem' : '0.9rem',
          fontWeight: 700,
          lineHeight: 1.1,
          textAlign: vertical ? 'center' : 'left',
        }}
      >
        {displayBusinessName}
      </span>
    </span>
  );
}
