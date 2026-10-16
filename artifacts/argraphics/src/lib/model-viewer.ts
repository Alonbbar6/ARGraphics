import modelViewerUrl from '@google/model-viewer/dist/model-viewer.min.js?url';

let modelViewerLoading: Promise<void> | null = null;

/** Loads the <model-viewer> element once, on first use, so pages without 3D never pay for it. */
export function ensureModelViewer() {
  if (customElements.get('model-viewer')) return Promise.resolve();
  if (modelViewerLoading) return modelViewerLoading;
  modelViewerLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = modelViewerUrl;
    script.dataset.argraphicsModelViewer = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => {
      modelViewerLoading = null;
      reject(new Error('The interactive 3D viewer could not load.'));
    }, { once: true });
    document.head.appendChild(script);
  });
  return modelViewerLoading;
}
