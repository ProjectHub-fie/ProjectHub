import contactMain from './handlers/contact-main.js';
import projectRequestsMain from './handlers/project-requests-main.js';
import projectsMain from './handlers/projects-main.js';
import authMain from './handlers/auth/auth-main.js';
import profileMain from './handlers/auth/profile-main.js';
import recoveryMain from './handlers/auth/recovery-main.js';

const handlers = {
  '/contact': contactMain,
  '/project-requests': projectRequestsMain,
  '/projects': projectsMain,
  '/auth/login': (req, res) => { req.query.action = 'login'; return authMain(req, res); },
  '/auth/register': (req, res) => { req.query.action = 'register'; return authMain(req, res); },
  '/auth/logout': (req, res) => { req.query.action = 'logout'; return authMain(req, res); },
  '/auth/user': profileMain,
  '/auth/me': profileMain,
  '/auth/upload-profile-pic': profileMain,
  '/auth/forgot-password': (req, res) => { req.query.action = 'forgot'; return recoveryMain(req, res); },
  '/auth/reset-password': (req, res) => { req.query.action = 'reset'; return recoveryMain(req, res); },
};

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/api/, '');

  if (path.startsWith('/projects/')) {
    const parts = path.split('/');
    if (parts.length >= 3) {
      req.query.projectId = parts[2];
      return projectsMain(req, res);
    }
  }

  const h = handlers[path];
  if (h) return h(req, res);

  res.status(404).json({ message: 'API endpoint not found' });
}