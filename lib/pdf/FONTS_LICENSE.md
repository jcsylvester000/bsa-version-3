# PDF fonts — sources and licence

`lib/pdf/pdfFonts.ts` embeds these fonts (base64 WOFF) for the site PDF. All are licensed under the
**SIL Open Font License 1.1** (https://openfontlicense.org), which permits embedding and redistribution.

| Constant | Font | Source package | Coverage |
|---|---|---|---|
| `POPPINS_400`, `POPPINS_600` | Poppins Regular / SemiBold | `@fontsource/poppins@5` (latin) | body text |
| `CANTATA_400` | Cantata One | `@fontsource/cantata-one@5` (latin) | headings |
| `JUDSON_400` | Judson | `@fontsource/judson@5` (latin) | recommendation rationale |
| `NOTO_PESO` | Noto Sans (subset) | `@fontsource/noto-sans@5` latin-ext | ₱ only |
| `NOTO_MATH_SUBSET` | Noto Sans Math (subset) | `@fontsource/noto-sans-math@5` | ✓ ▲ ≈ ↗ ⇗ ≤ ★ → |
| `NOTO_SYMBOLS_SUBSET` | Noto Sans Symbols 2 (subset) | `@fontsource/noto-sans-symbols-2@5` | ✕ |

Copyrights: Poppins © 2020 The Poppins Project Authors; Cantata One © Joana Correia; Judson © Daniel
Johnson; Noto © Google LLC.

## Regenerating
1. `npm pack @fontsource/<family>@5` and extract `files/*-latin-400-normal.woff` (etc.).
2. Subset the fallbacks with fontTools, e.g.
   `pyftsubset noto-sans-math-latin-400-normal.woff --unicodes=U+2713,U+25B2,U+2248,U+2197,U+21D7,U+2264,U+2605,U+2192 --flavor=woff --output-file=math.woff`
3. Base64 each file into `pdfFonts.ts` as `data:font/woff;base64,…`.

The PDF registers the brand fonts with the Noto subsets as **fallback families**
(`fontFamily: ['Poppins', 'NotoPeso', 'NotoMath', 'NotoSymbols']`), so a glyph missing from Poppins
is drawn from the first fallback that has it.

**Note — ↗ in the PDF:** react-pdf treats U+2197 (↗) as an emoji and drops it when no emoji source is
registered, so the PDF draws the Projected glyph as ⇗ (U+21D7) instead. The app keeps ↗.
