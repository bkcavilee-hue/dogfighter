import { startEngine } from './engine.js';

startEngine().catch((err) => {
  console.error('Engine failed to start:', err);
  const loading = document.getElementById('loading');
  if (loading) {
    loading.innerHTML = `<div style="color:#f66;font-family:monospace;">FATAL: ${err.message}</div>`;
  }
});
