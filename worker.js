// Minimal Worker for boing-wallet-api (D1, R2, KV bindings available for future use)
export default {
  async fetch(request, env) {
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  },
};
