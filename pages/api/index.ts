import { type Request, Response } from "express";
import express from "express";
import { registerRoutes } from "../../server/routes";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Initialize routes
const promise = registerRoutes(app);

export default async function handler(req: any, res: any) {
  const server = await promise;
  // Express app itself can handle requests
  return app(req, res);
}
