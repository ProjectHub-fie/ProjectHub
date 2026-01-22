import contact from './handlers/contact.js';
import projectRequests from './handlers/project-requests.js';
import forgotPassword from './handlers/auth/forgot-password.js';
import login from './handlers/auth/login.js';
import logout from './handlers/auth/logout.js';
import me from './handlers/auth/me.js';
import register from './handlers/auth/register.js';
import resetPassword from './handlers/auth/reset-password.js';
import uploadProfilePic from './handlers/auth/upload-profile-pic.js';
import user from './handlers/auth/user.js';
import interactions from './handlers/projects/[projectId]/interactions.js';

const handlers = {
  '/contact': contact,
  '/project-requests': projectRequests,
  '/auth/forgot-password': forgotPassword,
  '/auth/login': login,
  '/auth/logout': logout,
  '/auth/me': me,
  '/auth/register': register,
  '/auth/reset-password': resetPassword,
  '/auth/upload-profile-pic': uploadProfilePic,
  '/auth/user': user,
};

export default async function handler(req, res) {
  const path = req.url.split('?')[0];

  // Handle dynamic routes
  if (path.startsWith('/projects/') && path.endsWith('/interactions')) {
    const parts = path.split('/');
    if (parts.length === 4 && parts[1] === 'projects' && parts[3] === 'interactions') {
      req.query = { projectId: parts[2] };
      return interactions(req, res);
    }
  }

  const h = handlers[path];
  if (h) {
    return h(req, res);
  }

  res.status(404).json({ message: 'API endpoint not found' });
}