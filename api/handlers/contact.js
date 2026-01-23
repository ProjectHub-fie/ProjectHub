import { Resend } from "resend";
import nc from "next-connect";

const resend = new Resend(process.env.RESEND_API_KEY);

const handler = nc()
  .post(async (req, res) => {
    const { name, email, message } = req.body;

    try {
      await resend.emails.send({
        from: "Contact Form <onboarding@resend.dev>",
        to: ["dev.projecthub.fie@gmail.com"],
        replyTo: email,
        subject: "New Contact Message",
        text: `Name: ${name}\nEmail: ${email}\nMessage: ${message}\n sent from ProjectHub contact form.`,
      });

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

export default handler;