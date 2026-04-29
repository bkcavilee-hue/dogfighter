import { startEngine } from './engine.js';

function showFatal(msg) {
  console.error('[FATAL]', msg);
  const loading = document.getElementById('loading');
  if (!loading) return;
  loading.classList.remove('hidden');
  loading.innerHTML = `
    <div style="color:#f66;font-family:monospace;text-align:center;max-width:520px;padding:24px;">
      <div style="font-size:18px;margin-bottom:12px;letter-spacing:0.2em;">FATAL ERROR</div>
      <div style="opacity:0.8;font-size:12px;line-height:1.5;word-break:break-word;">${escapeHtml(String(msg))}</div>
      <div style="opacity:0.4;font-size:10px;margin-top:14px;">Check the browser console for details.</div>
    </div>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Catch synchronous errors anywhere in the page lifecycle.
window.addEventListener('error', (e) => {
  showFatal(e.error ? `${e.error.message}\n${e.error.stack || ''}` : e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  showFatal(e.reason?.message || e.reason || 'Unhandled promise rejection');
});

startEngine().catch((err) => showFatal(err?.stack || err?.message || String(err)));
