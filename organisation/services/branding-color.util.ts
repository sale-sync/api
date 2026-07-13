import type { BrandingColorScale, BrandingColorScaleStep } from '@sale-sync/shared';

// Generates an 11-stop (50-950) tint/shade scale from a single input hex, approximating the shape of
// the hand-authored scales in theme-maker/{shape,wello}/design-system/primitive-tokens.ts: hue/saturation
// pinned constant across all stops, only lightness varies. This is an approximation, not a reproduction
// — those two hand-authored scales don't share one proportional curve either.

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

function hexToRgb(hex: string): Rgb {
    let normalized = hex.replace('#', '');
    if (normalized.length === 3) {
        normalized = normalized
            .split('')
            .map((c) => c + c)
            .join('');
    }
    const int = parseInt(normalized, 16);
    return {
        r: (int >> 16) & 255,
        g: (int >> 8) & 255,
        b: int & 255,
    };
}

function rgbToHex({ r, g, b }: Rgb): string {
    const toHex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;

    if (max === min) {
        return { h: 0, s: 0, l: l * 100 };
    }

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    let h: number;
    switch (max) {
        case rn:
            h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
            break;
        case gn:
            h = ((bn - rn) / d + 2) * 60;
            break;
        default:
            h = ((rn - gn) / d + 4) * 60;
            break;
    }

    return { h, s: s * 100, l: l * 100 };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
    const sn = s / 100;
    const ln = l / 100;

    if (sn === 0) {
        const v = ln * 255;
        return { r: v, g: v, b: v };
    }

    const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
    const p = 2 * ln - q;

    const hueToRgb = (t: number): number => {
        let tt = t;
        if (tt < 0) tt += 1;
        if (tt > 1) tt -= 1;
        if (tt < 1 / 6) return p + (q - p) * 6 * tt;
        if (tt < 1 / 2) return q;
        if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
        return p;
    };

    const hn = h / 360;
    return {
        r: hueToRgb(hn + 1 / 3) * 255,
        g: hueToRgb(hn) * 255,
        b: hueToRgb(hn - 1 / 3) * 255,
    };
}

// Tint stops (50-400): eased position `t` toward the base lightness — small gaps early, growing gaps
// closer to 400, mirroring the hand-authored scales' accelerating tint curve.
const TINT_STEPS: { key: BrandingColorScaleStep; t: number }[] = [
    { key: '50', t: 0.08 },
    { key: '100', t: 0.18 },
    { key: '200', t: 0.34 },
    { key: '300', t: 0.55 },
    { key: '400', t: 0.8 },
];

// Shade stops (600-950): near-linear ramp down from the base lightness to a floor.
const SHADE_STEPS: { key: BrandingColorScaleStep; t: number }[] = [
    { key: '600', t: 0.2 },
    { key: '700', t: 0.4 },
    { key: '800', t: 0.6 },
    { key: '900', t: 0.8 },
    { key: '950', t: 1.0 },
];

const TINT_EASE_POWER = 1.8;

export function generateColorScale(hex: string): BrandingColorScale {
    const baseRgb = hexToRgb(hex);
    const { h, s, l: baseL } = rgbToHsl(baseRgb);

    const lightMax = Math.max(97, Math.min(99, baseL + 3));
    const floorL = Math.min(Math.max(baseL * 0.2, 2), 15, baseL - 3 > 0 ? baseL - 3 : 2);

    const scale = {} as Record<BrandingColorScaleStep, string>;

    for (const { key, t } of TINT_STEPS) {
        const eased = Math.pow(t, TINT_EASE_POWER);
        const l = lightMax - (lightMax - baseL) * eased;
        scale[key] = rgbToHex(hslToRgb({ h, s, l }));
    }

    // 500 is the input hex verbatim — no HSL round-trip, avoids drift from the literal value the
    // client picked.
    scale['500'] = hex.startsWith('#') ? hex : `#${hex}`;

    for (const { key, t } of SHADE_STEPS) {
        const l = baseL - (baseL - floorL) * t;
        scale[key] = rgbToHex(hslToRgb({ h, s, l }));
    }

    return scale;
}
