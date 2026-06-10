import { useAppStore } from '../../store/useAppStore';

export default function Logo({
    className,
    style,
    vertical = false,
    showBusinessName = true
}) {
    const companyName = useAppStore(state => state.companyProfile?.name);
    const rawName = companyName ? companyName.toUpperCase() : 'TU NEGOCIO';

    const maxChars = 22;
    const displayHorizontalName = rawName.length > maxChars
        ? `${rawName.substring(0, maxChars - 3)}...`
        : rawName;

    const totalChars = 8 + displayHorizontalName.length;
    const estimatedWidth = (totalChars * 16) + 130;
    const finalWidth = showBusinessName ? Math.max(260, estimatedWidth) : 180;

    if (vertical) {
        return (
            <svg
                viewBox="0 0 260 110"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className={className}
                style={style}
            >
                <rect width="260" height="110" rx="16" fill="var(--light-background)" />

                <path d="M20 20H33L27 60H14L20 20Z" fill="#60A5FA" />
                <path d="M25 60H55L47 46H29L25 60Z" fill="#3B82F6" />

                <text
                    x="65"
                    y="45"
                    fontFamily="sans-serif"
                    fontWeight="800"
                    fontSize="20"
                    fill="var(--text-dark)"
                    letterSpacing="0.5"
                >
                    LANZO
                    {showBusinessName && (
                        <>
                            {' '}
                            <tspan fontSize="17" fontWeight="400" fill="var(--text-light)">x</tspan>
                            <tspan x="65" dy="30" fontSize="17" fill="var(--primary-color)">
                                {rawName.length > 18 ? `${rawName.substring(0, 16)}..` : rawName}
                            </tspan>
                        </>
                    )}
                </text>

                {showBusinessName && <circle cx="240" cy="20" r="5" fill="#10B981" />}
            </svg>
        );
    }

    return (
        <svg
            viewBox={`0 0 ${finalWidth} 80`}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            style={style}
        >
            <rect width={finalWidth} height="80" rx="40" fill="var(--light-background)" />

            <path d="M25 20H38L32 60H19L25 20Z" fill="#60A5FA" />
            <path d="M30 60H60L52 46H34L30 60Z" fill="#3B82F6" />

            <text
                x="85"
                y="50"
                fontFamily="sans-serif"
                fontWeight="800"
                fontSize="24"
                fill="var(--text-dark)"
                letterSpacing="0.5"
            >
                LANZO
                {showBusinessName && (
                    <>
                        <tspan fontSize="18" fontWeight="400" fill="var(--text-light)" dx="8">x</tspan>
                        <tspan fill="var(--primary-color)" dx="8">{displayHorizontalName}</tspan>
                    </>
                )}
            </text>

            {showBusinessName && (
                <circle cx={finalWidth - 25} cy="40" r="6" fill="#10B981" />
            )}
        </svg>
    );
}
