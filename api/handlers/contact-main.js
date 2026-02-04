import { storage } from "./lib/storage.js";
import nc from "next-connect";

import { Resend } from 'resend';

const handler = nc()
  .post(async (req, res) => {
    try {
      const { name, email, subject, message, captchaToken } = req.body;
      if (!name || !email || !message) return res.status(400).json({ message: "Missing required fields" });

      if (captchaToken && process.env.NODE_ENV === 'production') {
        const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
        const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `secret=${turnstileSecret}&response=${captchaToken}`
        });
        const verifyData = await verifyResponse.json();
        if (!verifyData.success) return res.status(400).json({ message: "Security verification failed" });
      }

      if (!process.env.RESEND_API_KEY) {
        return res.status(500).json({ message: "Email service not configured" });
      }

      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Contact Form <onboarding@resend.dev>',
        to: process.env.EMAIL_USER || 'dev.projecthub.fie@gmail.com',
        subject: `New Contact Form: ${subject || 'No Subject'}`,
        replyTo: email,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Message:</strong></p>
          <p>${message.replace(/\n/g, '<br>')}</p>
        `,
      });

      res.json({ message: "Contact form submitted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to submit contact form" });
    }
  });

export default handler;