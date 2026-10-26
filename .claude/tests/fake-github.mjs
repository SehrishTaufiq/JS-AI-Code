// Minimal fake of the GitHub REST endpoints the factory scripts use, with ETag/304 support and a
// request log, so the scripts can be tested end to end without network or tokens.
import http from 'node:http';
import crypto from 'node:crypto';

export async function startFakeGitHub(state) {
  // state: { issues: [], pulls: [], reviews: {n: []}, inline: {n: []}, comments: {n: []} }
  const log = [];
  let nextId = 1000;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const parts = url.pathname.split('/').filter(Boolean); // repos o r ...
      const route = parts.slice(3).join('/');
      const json = body ? JSON.parse(body) : null;
      log.push({ method: req.method, path: url.pathname, query: url.search, auth: req.headers.authorization || null, body: json, status: 0 });
      const send = (status, data, etagged = req.method === 'GET') => {
        const payload = JSON.stringify(data);
        if (etagged) {
          const etag = `"${crypto.createHash('md5').update(payload).digest('hex')}"`;
          res.setHeader('ETag', etag);
          if (req.headers['if-none-match'] === etag) {
            log.at(-1).status = 304;
            res.writeHead(304);
            return res.end();
          }
        }
        log.at(-1).status = status;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(payload);
      };
      const page = Number(url.searchParams.get('page') || 1);
      const paged = (list) => (page === 1 ? list : []);
      let m;
      if (req.method === 'GET' && route === 'issues') return send(200, paged(state.issues));
      if (req.method === 'GET' && route === 'pulls') {
        let list = state.pulls;
        const head = url.searchParams.get('head');
        if (head) list = list.filter((p) => `${parts[1]}:${p.head.ref}` === head);
        if (url.searchParams.get('state') === 'open') list = list.filter((p) => p.state === 'open');
        return send(200, paged(list));
      }
      if (req.method === 'GET' && (m = route.match(/^pulls\/(\d+)\/reviews$/))) return send(200, paged(state.reviews?.[m[1]] || []));
      if (req.method === 'GET' && (m = route.match(/^pulls\/(\d+)\/comments$/))) return send(200, paged(state.inline?.[m[1]] || []));
      if (req.method === 'GET' && (m = route.match(/^issues\/(\d+)\/comments$/))) return send(200, paged(state.comments?.[m[1]] || []));
      if (!req.headers.authorization) return send(401, { message: 'Requires authentication' }, false);
      if (req.method === 'POST' && route === 'pulls') {
        const pr = { number: nextId++, state: 'open', html_url: `https://github.com/o/r/pull/${nextId}`, head: { ref: json.head }, base: { ref: json.base }, title: json.title, body: json.body };
        state.pulls.push(pr);
        return send(201, pr, false);
      }
      if (req.method === 'PATCH' && (m = route.match(/^pulls\/(\d+)$/))) {
        const pr = state.pulls.find((p) => p.number === Number(m[1]));
        Object.assign(pr, { title: json.title, body: json.body, base: { ref: json.base } });
        return send(200, pr, false);
      }
      if (req.method === 'POST' && (m = route.match(/^issues\/(\d+)\/comments$/))) {
        const c = { id: nextId++, html_url: `https://github.com/o/r/issues/${m[1]}#c${nextId}`, body: json.body, created_at: new Date().toISOString() };
        (state.comments[m[1]] ||= []).push(c);
        return send(201, c, false);
      }
      send(404, { message: `Not Found: ${req.method} ${route}` }, false);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, log, state, close: () => new Promise((r) => server.close(r)) };
}

export const issue = (number, extra = {}) => ({
  number,
  title: `Ticket #${number}`,
  state: 'open',
  user: { login: 'mashhoodr' },
  labels: [],
  html_url: `https://github.com/o/r/issues/${number}`,
  body: `Do thing ${number}`,
  ...extra,
});

export const pull = (number, ref, extra = {}) => ({
  number,
  state: 'open',
  merged_at: null,
  html_url: `https://github.com/o/r/pull/${number}`,
  head: { ref },
  base: { ref: 'main' },
  body: '',
  ...extra,
});
