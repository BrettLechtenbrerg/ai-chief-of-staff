# AI Chief of Staff — Brand Assets

Source logo files. Build artifacts (`.icns`, `.ico`, tray PNGs) are generated
from these and live in `build/` and `assets/`.

## Files

| File | Use case |
|------|----------|
| `logo-on-white.png` | 1254×1254 PNG with solid white background. Use on dark surfaces, in print, or anywhere transparency would be a problem. The original supplied by Brett. |
| `logo-transparent.png` | 1254×1254 PNG with white removed via alpha. Use on web pages, marketing flyers, slide decks, and as the source for app icons. Edges are anti-aliased — composite cleanly over any color. |

## Regenerating build artifacts

When the logo changes, re-run the icon generator (added in a later commit):

```bash
node scripts/generate-icons.cjs
```

That script reads `logo-transparent.png` and writes:

- `build/icon.icns` — macOS app bundle icon
- `build/icon.ico` — Windows .exe / installer icon
- `assets/tray/*` — menu-bar and system-tray icons at @1x and @2x
