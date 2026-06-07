Sandbox Secretary resolves local model assets from this directory first.

Place Apache-2.0 or MIT licensed browser-ready model folders here when shipping an
air-gapped build. The default runtime configuration uses:

- `Xenova/whisper-tiny.en` for speech-to-text through Transformers.js.
- `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` for WebLLM polishing and translation.

When these folders are not bundled, the app can download them once while online
and the service worker/browser cache will retain the artifacts for offline use.
