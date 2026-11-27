// QR decoder worker: zxing-wasm (ZXing-C++) with "try harder" options plus
// image preprocessing passes for shadowed / low-contrast / curved labels.
// Runs off the main thread so the camera preview never stutters.
import { readBarcodes, prepareZXingModule } from '/vendor/zxing-wasm/es/reader/index.js';

prepareZXingModule({
  overrides: {
    locateFile: (file, prefix) =>
      file.endsWith('.wasm') ? '/vendor/zxing-wasm/reader/zxing_reader.wasm' : prefix + file
  },
  fireImmediately: true
});

// QR first; DataMatrix / Code 128 cover other common asset-label symbologies.
const FORMATS = ['QRCode', 'MicroQRCode', 'DataMatrix', 'Code128'];

const BASE_OPTIONS = {
  formats: FORMATS,
  tryHarder: true,     // slower, more thorough detector
  tryRotate: true,     // angled labels
  tryInvert: true,     // light-on-dark labels
  tryDownscale: true,  // large codes close to the lens
  maxNumberOfSymbols: 1
};

// Grayscale + histogram contrast stretch (2nd..98th percentile). Helps faded and shadowed labels.
function contrastStretch(data) {
  const n = data.length / 4;
  const lum = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const y = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    lum[j] = y;
    hist[y]++;
  }
  const lowCount = n * 0.02, highCount = n * 0.98;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= lowCount) { lo = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= highCount) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const v = ((lum[j] - lo) * 255) / range;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  return lum;
}

// Bradley-Roth adaptive threshold using an integral image. Evens out uneven lighting
// (a shadow across half the code, glare on a curved surface).
function adaptiveThreshold(data, width, height) {
  const lum = contrastStretch(data);
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    for (let x = 1; x <= width; x++) {
      rowSum += lum[(y - 1) * width + (x - 1)];
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }
  const s = Math.max(8, Math.floor(Math.min(width, height) / 10));
  const half = s >> 1;
  const t = 0.85; // pixel is dark if it is 15% below the local mean
  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - half), y2 = Math.min(height - 1, y + half);
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - half), x2 = Math.min(width - 1, x + half);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = integral[(y2 + 1) * (width + 1) + (x2 + 1)] - integral[y1 * (width + 1) + (x2 + 1)]
        - integral[(y2 + 1) * (width + 1) + x1] + integral[y1 * (width + 1) + x1];
      const v = lum[y * width + x] * count < sum * t ? 0 : 255;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
}

self.onmessage = async (event) => {
  const { id, width, height, buffer, pass } = event.data;
  try {
    const data = new Uint8ClampedArray(buffer);
    const options = { ...BASE_OPTIONS };
    switch (pass) {
      case 'stretch':
        contrastStretch(data);
        options.binarizer = 'GlobalHistogram';
        options.tryDenoise = true;
        break;
      case 'adaptive':
        adaptiveThreshold(data, width, height);
        options.binarizer = 'FixedThreshold';
        options.tryDenoise = true;
        break;
      case 'denoise':
        options.tryDenoise = true;
        break;
      default:
        options.binarizer = 'LocalAverage';
    }
    const results = await readBarcodes(new ImageData(data, width, height), options);
    const hit = results.find(r => r.isValid && r.text);
    self.postMessage({ id, text: hit ? hit.text : null, format: hit ? hit.format : null });
  } catch (error) {
    self.postMessage({ id, text: null, error: String(error && error.message || error) });
  }
};
