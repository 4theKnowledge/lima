/**
 * Composite the map basemap (MapLibre) and the deck.gl hex overlay into a
 * single PNG and trigger a download. Both canvases share the same viewport
 * dimensions and pixel ratio so a straight drawImage into a fresh canvas
 * gets us pixel-parity with what the operator sees.
 *
 * MapLibre needs `preserveDrawingBuffer: true` on <Map> for its canvas to
 * be readable via toDataURL / drawImage; deck.gl enables it by default.
 * If that flag is off, the maplibre canvas draws black.
 */

export function captureMapScreenshot(filename = "lima-map.png"): boolean {
  // The maplibre canvas has class `maplibregl-canvas`. Deck's canvas sits
  // as the topmost canvas inside the deck container — we grab the last
  // <canvas> in the map root that isn't the maplibre one.
  const canvases = Array.from(
    document.querySelectorAll("canvas"),
  ) as HTMLCanvasElement[];
  const mapCanvas = canvases.find((c) =>
    c.classList.contains("maplibregl-canvas"),
  );
  const deckCanvas = canvases.find(
    (c) => c !== mapCanvas && c.width > 0 && c.height > 0,
  );
  if (!mapCanvas || !deckCanvas) return false;

  // Composite at the larger of the two device-pixel sizes so we don't
  // downscale either layer. In practice they match.
  const w = Math.max(mapCanvas.width, deckCanvas.width);
  const h = Math.max(mapCanvas.height, deckCanvas.height);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return false;

  try {
    ctx.drawImage(mapCanvas, 0, 0, w, h);
    ctx.drawImage(deckCanvas, 0, 0, w, h);
  } catch (e) {
    // Almost certainly a tainted canvas (cross-origin basemap tiles without
    // CORS). CartoDB tiles do send CORS headers, so this shouldn't fire in
    // practice — log and give up.
    console.error("[screenshot] canvas draw failed", e);
    return false;
  }

  out.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
  return true;
}
