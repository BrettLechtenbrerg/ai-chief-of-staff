import { initPixel } from "@kenkaiiii/gg-pixel";

const key = process.env.GG_PIXEL_KEY || "pk_live_481c64dc8ca30105cb960479fe4f2791";
if (key) {
  initPixel({
    projectKey: key,
    sink: { kind: "http", ingestUrl: "https://gg-pixel-server.buzzbeamaustralia.workers.dev/ingest" },
  });
}
