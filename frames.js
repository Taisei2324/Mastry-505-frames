// MASTRY scroll-scrub hero — frame manifest (Station 1 output).
// Loaded via <script src="frames.js"></script>. Defines one global, no exports.
// Frame i (1-based) = <tier dir> + String(i).padStart(pad,"0") + "." + ext
// scrubber.js picks the tier: ORIENTATION+VIEWPORT pick landscape vs portrait
// (phones download only the center slice they can actually show — the portrait
// dirs are pre-cropped to the exact 9:16 slice cover-fit displays, so nothing
// visible is lost and ~2/3 of the bytes never leave the server); CONNECTION
// picks full vs low resolution within that shape.
window.MASTRY_FRAMES = {
  base:     "frames/",       // 1920x1080 landscape — desktop default (~15.4 MB)
  baseLow:  "frames-720/",   // 1280x720 landscape (~8.8 MB), desktop on SLOW connections
                             //   (data-saver / 2g / 3g / weak 4g) so the hero still arrives fast.
  baseP:    "frames-p/",     // 608x1080 portrait center-crop — PHONE default (~5.4 MB).
                             //   Identical pixels to what cover-fit shows from the 1080p
                             //   landscape tier on a portrait phone — just not downloading
                             //   the ~70% that gets cropped away. iOS (no Network
                             //   Information API) -> this tier, never the 15 MB one.
  basePLow: "frames-p-720/", // 406x720 portrait center-crop (~3.1 MB), phones on SLOW connections.
  baseLite:  "frames-lite/",   // 854x480 landscape (~3.8 MB TOTAL) — the CRAWL tier. Chosen when
                               //   MEASURED throughput can't sustain playback of the picked tier
                               //   (~300 kbps mobile 4g at its worst): ~5KB/frame arrives at
                               //   10+ fps even on such links, so the glide plays instead of
                               //   slideshow-stepping one frame per second.
  basePLite: "frames-p-lite/", // 304x540 portrait center-crop (~1.6 MB total), crawl tier for phones.
  ext:     "webp",
  count:   505,             // all 505 frames kept
  pad:     4,               // zero-pad width -> "0001"
  width:   1920, height: 1080,     // 1080p landscape tier pixel dims (engine cover-fits to natural size)
  poster:  "poster.jpg",  // full-quality late-Greek still (1920x1080 q90) for OG + no-JS fallback
  placeholder: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAA0JCgsKCA0LCwsPDg0QFCEVFBISFCgdHhghMCoyMS8qLi00O0tANDhHOS0uQllCR05QVFVUMz9dY1xSYktTVFH/2wBDAQ4PDxQRFCcVFSdRNi42UVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVH/wAARCAAOABgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDWbUg/yxxbO2TGWqs97MCXKeYgPzfusY9O9cSJZDhjIw46AmkNxIAQHcD0DGpKOym1KN4nVItjlSFbbnBorimuZiCPNcj03GigR//Z",
  totalBytes: 16180572,     // desktop 1080p tier total bytes (report/preload budgeting)
  tierBytes: {              // exact per-tier totals (report/preload budgeting)
    "frames/": 16180572, "frames-720/": 9277500,
    "frames-p/": 5653514, "frames-p-720/": 3279686,
    "frames-lite/": 3838434, "frames-p-lite/": 1590210
  }
};
