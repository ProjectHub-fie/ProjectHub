import { type Request, Response } from "express";

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).end();
  (req.session as any).isAdminLoggedIn = false;
  res.json({ success: true });
}
