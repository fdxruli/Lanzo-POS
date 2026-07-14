export default function LogoMark({ className, style }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M20 12H34L27 52H13L20 12Z" fill="var(--brand-accent)" />
      <path d="M27 52H54L46 38H30L27 52Z" fill="var(--brand-accent-hover)" />
    </svg>
  );
}

export { LogoMark };
