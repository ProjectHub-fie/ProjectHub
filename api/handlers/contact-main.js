import { storage } from "./lib/storage.js";
import nc from "next-connect";

const handler = nc()
  .post(async (req, res) => {
    try {
      const { name, email, subject, message } = req.body;
      if (!name || !email || !message) return res.status(400).json({ message: "Missing required fields" });
      // Logic for sending email via Resend would go here
      res.json({ message: "Contact form submitted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to submit contact form" });
    }
  });

export default handler;