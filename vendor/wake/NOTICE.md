# Hey Jarvis: third-party files

Used by `js/wake.js` (hands-free voice on Home). Loaded only when hands-free is turned on; the service worker
then keeps them in its cache. `worklet.js` is the app's own (it hands the model 80 ms of 16 kHz audio at a time).

- `models/melspectrogram.onnx`, `models/embedding_model.onnx`, `models/hey_jarvis_v0.1.onnx`: from
  [openWakeWord](https://github.com/dscripka/openWakeWord) v0.5.1 by David Scripka. The pre-trained models are licensed
  [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/): personal, non-commercial use, with attribution,
  under the same license. They are unmodified.
- `ort.wasm.min.js`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm`: ONNX Runtime Web 1.20.1,
  © Microsoft, MIT license.
