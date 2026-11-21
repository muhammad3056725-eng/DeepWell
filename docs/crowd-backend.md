# Optional crowd rarity backend

By default rarity comes from Wikidata only. To blend in real player data, deploy this tiny Cloudflare Worker (free tier) and put its URL in `CROWD_ENDPOINT` in `js/config.js`.

The game calls two endpoints:

- `GET  /stats?p=<promptKey>&k=<answerKey>` returns `{"count": <times this answer was given>, "total": <answers given for this prompt>}`
- `POST /submit` with JSON `{"p": "<promptKey>", "k": "<answerKey>"}` records one valid answer.

Once a prompt has `CROWD_MIN_SAMPLES` answers (default 30), the score becomes a blend: `CROWD_WEIGHT` (default 0.5) of the crowd-based score plus the rest from Wikidata.

## Worker (KV storage)

1. Cloudflare dashboard > Workers & Pages > Create Worker. Create a KV namespace called `DEEPWELL` and bind it to the Worker as `KV`.
2. Paste:

```js
const CORS = { 'Access-Control-Allow-Origin': 'https://deepwell.games', 'Access-Control-Allow-Headers': 'Content-Type' };
const ok = (obj) => new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json', ...CORS } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/stats') {
      const p = (url.searchParams.get('p') || '').slice(0, 80), k = (url.searchParams.get('k') || '').slice(0, 80);
      const [count, total] = await Promise.all([env.KV.get(`c:${p}:${k}`), env.KV.get(`t:${p}`)]);
      return ok({ count: Number(count || 0), total: Number(total || 0) });
    }
    if (url.pathname === '/submit' && req.method === 'POST') {
      const { p, k } = await req.json().catch(() => ({}));
      if (typeof p !== 'string' || typeof k !== 'string' || !p || !k || p.length > 80 || k.length > 80) return ok({ ok: false });
      const ck = `c:${p}:${k}`, tk = `t:${p}`;
      const [c, t] = await Promise.all([env.KV.get(ck), env.KV.get(tk)]);
      await Promise.all([env.KV.put(ck, String(Number(c || 0) + 1)), env.KV.put(tk, String(Number(t || 0) + 1))]);
      return ok({ ok: true });
    }
    return new Response('not found', { status: 404 });
  },
};
```

3. Set `CROWD_ENDPOINT: 'https://your-worker.your-name.workers.dev'` in `js/config.js`, commit and push.

## Known limits

KV is eventually consistent and the read-then-write counter can lose a few counts under heavy traffic. That is fine for rarity estimates. For exact counts, use Cloudflare D1 or a Durable Object. Nothing stops a player from submitting scripted answers, so add rate limiting before relying on this for anything competitive.
