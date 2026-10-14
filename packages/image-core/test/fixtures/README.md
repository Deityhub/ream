# Image fixtures

| File | What | Source |
|---|---|---|
| `photo-420.jpg` | 96x64 baseline JPEG, 4:2:0 | made with macOS `sips` from a generated gradient |
| `cmyk.jpg` | 96x64 four-component (Adobe CMYK) JPEG, profile and EXIF stripped | `sips` with Generic CMYK profile |
| `progressive.jpg` | 640x430 progressive JPEG with the full libjpeg scan script (spectral selection and successive approximation) | `test/data/image.jpg` of [less](https://github.com/less/less.js) 3.10.3, Apache-2.0 |
| `*.ref.png`, `progressive.ref.json` | what Chromium's decoder (libjpeg-turbo) gives for the file above, as RGBA (PNG) or as 16x16 cell means (JSON) | Electron `createImageBitmap`, no colour conversion |

Our decoder is compared against these with a tolerance of a few levels, since IDCT rounding differs by one or two between implementations.
