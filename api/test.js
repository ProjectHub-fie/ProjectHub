export default async function handler(req, res) {
  return res.json({
    message: 'API is working!',
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.url
  });
}