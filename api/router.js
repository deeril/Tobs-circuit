import app from '../server.js';

export default function routeApiRequest(request, response) {
  const rewrittenUrl = new URL(request.url, 'https://tobs-circuit.invalid');
  const routePath = rewrittenUrl.searchParams.get('__vercel_path');
  if (!routePath) {
    response.status(400).json({ error: 'API route path is missing.' });
    return;
  }

  const query = new URLSearchParams();
  for (const [key, value] of rewrittenUrl.searchParams.entries()) {
    if (key !== '__vercel_path') query.append(key, value);
  }
  const remainingQuery = query.toString();
  request.url = `/api/${routePath.replace(/^\/+/, '')}${remainingQuery ? `?${remainingQuery}` : ''}`;
  return app(request, response);
}
