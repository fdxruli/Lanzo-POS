import markAssetUrl from '../../../brand/lanzo-mark.svg?url';

export default function LogoMark({ className, style }) {
  return (
    <img
      src={markAssetUrl}
      alt=""
      aria-hidden="true"
      className={className}
      style={style}
    />
  );
}

export { LogoMark };
