import React from 'react';
export default function IntroScreen({ onGetStarted, onLogin }) {
  return (
    <main className="droplag-intro" aria-label="DropLag introduction">
      <section className="droplag-intro-panel">
        <div className="droplag-intro-visual" aria-hidden="true">
          <svg viewBox="0 0 380 285" role="presentation">
            <defs>
              <linearGradient id="droplag-road" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#373a40" />
                <stop offset="1" stopColor="#23252a" />
              </linearGradient>
              <linearGradient id="droplag-pylon" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#fafafa" />
                <stop offset="1" stopColor="#9ca3af" />
              </linearGradient>
              <linearGradient id="droplag-orange" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ff7a28" />
                <stop offset="1" stopColor="#df4700" />
              </linearGradient>
              <filter id="droplag-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="10" stdDeviation="8" floodColor="#000" floodOpacity=".55" />
              </filter>
            </defs>

            <path d="M110 175 C165 130 255 122 345 142 L345 154 C255 135 165 144 110 188 Z" fill="#32353b" />
            <path d="M115 178 C168 134 255 126 342 145" fill="none" stroke="#64748b" strokeWidth="1.5" opacity=".65" />

            <g>
              <line x1="154" y1="42" x2="112" y2="174" stroke="#cbd5e1" strokeWidth="1.1" opacity=".65" />
              <line x1="154" y1="56" x2="124" y2="167" stroke="#cbd5e1" strokeWidth="1.1" opacity=".65" />
              <line x1="154" y1="70" x2="136" y2="160" stroke="#cbd5e1" strokeWidth="1.1" opacity=".65" />
              <line x1="158" y1="42" x2="212" y2="136" stroke="#cbd5e1" strokeWidth="1.1" opacity=".65" />
              <line x1="158" y1="56" x2="198" y2="139" stroke="#cbd5e1" strokeWidth="1.1" opacity=".65" />
              <line x1="158" y1="70" x2="184" y2="143" stroke="#cbd5e1" strokeWidth="1.1" opacity=".65" />
              <path d="M152 34 L136 168 L143 168 L156 54 L169 164 L176 164 L160 34 Z" fill="url(#droplag-pylon)" />
              <rect x="145" y="106" width="22" height="5" rx="1" fill="#e2e8f0" />
              <path d="M136 168 L136 220 L143 220 L143 168 Z" fill="#cbd5e1" />
              <path d="M169 164 L169 220 L176 220 L176 164 Z" fill="#94a3b8" />
            </g>

            <g>
              <line x1="252" y1="54" x2="215" y2="135" stroke="#cbd5e1" strokeWidth="1" opacity=".55" />
              <line x1="252" y1="68" x2="228" y2="134" stroke="#cbd5e1" strokeWidth="1" opacity=".55" />
              <line x1="256" y1="54" x2="302" y2="136" stroke="#cbd5e1" strokeWidth="1" opacity=".55" />
              <line x1="256" y1="68" x2="288" y2="135" stroke="#cbd5e1" strokeWidth="1" opacity=".55" />
              <path d="M250 46 L238 148 L244 148 L254 64 L264 148 L270 148 L258 46 Z" fill="url(#droplag-pylon)" />
              <rect x="244" y="104" width="20" height="4.5" rx="1" fill="#e2e8f0" />
              <path d="M238 148 L238 218 L244 218 L244 148 Z" fill="#cbd5e1" />
              <path d="M264 148 L264 218 L270 218 L270 148 Z" fill="#94a3b8" />
            </g>

            <g transform="translate(205 86)">
              <g className="droplag-map-pin">
                <path d="M0 -18 C-7 -18 -12 -13 -12 -6 C-12 3 0 14 0 14 C0 14 12 3 12 -6 C12 -13 7 -18 0 -18 Z" fill="#e2e8f0" />
                <circle cx="0" cy="-6" r="4.5" fill="url(#droplag-orange)" />
              </g>
            </g>
            <g transform="translate(302 72)">
              <g className="droplag-map-pin droplag-map-pin-delay">
                <path d="M0 -14 C-5.5 -14 -9.5 -10 -9.5 -4.5 C-9.5 2.5 0 11 0 11 C0 11 9.5 2.5 9.5 -4.5 C9.5 -10 5.5 -14 0 -14 Z" fill="#cbd5e1" />
                <circle cx="0" cy="-4.5" r="3.5" fill="url(#droplag-orange)" />
              </g>
            </g>
            <g transform="translate(334 114)">
              <g className="droplag-map-pin droplag-map-pin-delay-2">
                <path d="M0 -20 C-8 -20 -14 -14 -14 -6.5 C-14 3.5 0 16 0 16 C0 16 14 3.5 14 -6.5 C14 -14 8 -20 0 -20 Z" fill="#f1f5f9" />
                <circle cx="0" cy="-6.5" r="5" fill="url(#droplag-orange)" />
              </g>
            </g>

            <g filter="url(#droplag-shadow)">
              <path d="M32 224 C125 262 260 272 355 256 L355 264 C260 280 125 270 32 232 Z" fill="#52555e" />
              <path d="M32 224 C110 205 195 198 355 232 L355 256 C260 272 125 262 32 224 Z" fill="url(#droplag-road)" />
              <path d="M55 224 C145 225 240 236 345 247" fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="12 10" opacity=".65" />
            </g>

            <g transform="translate(45 142)">
              <path d="M-3 72 Q-7 33 0 0" fill="none" stroke="#78553a" strokeWidth="5.5" strokeLinecap="round" />
              <path d="M0 0 C-18 -12 -32 -4 -36 8 C-22 3 -10 2 0 0 Z" fill="#4d7c0f" />
              <path d="M0 0 C-14 -22 -2 -34 10 -34 C4 -20 2 -10 0 0 Z" fill="#65a30d" />
              <path d="M0 0 C16 -20 32 -12 36 2 C22 -2 10 -2 0 0 Z" fill="#4d7c0f" />
              <path d="M0 0 C18 -4 28 10 26 22 C16 12 8 6 0 0 Z" fill="#3f6212" />
            </g>

            <g transform="translate(328 176)">
              <path d="M4 62 Q8 29 0 0" fill="none" stroke="#78553a" strokeWidth="5" strokeLinecap="round" />
              <path d="M0 0 C-18 -10 -30 -2 -33 10 C-20 4 -9 2 0 0 Z" fill="#4d7c0f" />
              <path d="M0 0 C-10 -20 4 -30 14 -28 C7 -16 3 -8 0 0 Z" fill="#65a30d" />
              <path d="M0 0 C16 -16 30 -8 33 5 C20 0 9 -1 0 0 Z" fill="#4d7c0f" />
              <path d="M0 0 C16 -2 24 12 21 22 C12 12 6 6 0 0 Z" fill="#3f6212" />
            </g>

            <g className="droplag-moving-bike">
              <ellipse cx="52" cy="68" rx="44" ry="10" fill="#000" opacity=".55" />
              <rect x="54" y="14" width="28" height="25" rx="5" fill="url(#droplag-orange)" />
              <rect x="58" y="19" width="20" height="3" rx="1.5" fill="#fff" opacity=".75" />
              <path d="M38 22 C42 15 52 16 54 24 L52 42 L36 40 Z" fill="#ff5a00" />
              <circle cx="43" cy="11" r="9.5" fill="#f8fafc" />
              <path d="M34 10 C34 6 41 5 43 9 L41 14 L34 13 Z" fill="#1e293b" />
              <path d="M42 24 L27 32" stroke="#ea580c" strokeWidth="5.5" strokeLinecap="round" />
              <path d="M44 40 L38 56 L46 58" fill="none" stroke="#1e293b" strokeWidth="6.5" strokeLinecap="round" />
              <path d="M22 48 L46 42 L74 44 L82 56 L30 58 Z" fill="#6b7280" />
              <circle cx="22" cy="59" r="11" fill="#d1d5db" stroke="#64748b" strokeWidth="2.5" />
              <circle cx="22" cy="59" r="5" fill="#f1f5f9" />
              <circle cx="76" cy="58" r="11" fill="#d1d5db" stroke="#64748b" strokeWidth="2.5" />
              <circle cx="76" cy="58" r="5" fill="#f1f5f9" />
            </g>
          </svg>
        </div>

        <div className="droplag-intro-copy">
          <h1>Moving Lagos<br />Forward</h1>
          <p>Your reliable rides and instant package delivery across the city</p>
        </div>

        <div className="droplag-intro-actions">
          <button type="button" className="droplag-get-started" onClick={onGetStarted}>
            Get started
          </button>
          <button type="button" className="droplag-login-link" onClick={onLogin}>
            Log in
          </button>
        </div>
      </section>
    </main>
  );
}
