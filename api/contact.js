const nodemailer = await import('nodemailer');      // Email content
      const mailOptions = {
        from: `"Contact Form" <dev.projecthub.fie@gmail.com>`,
        to: 'dev.projecthub.fie@gmail.com',
        subject: `New Contact Form: ${subject}`,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Message:</strong></p>
          <p>${message.replace(/\n/g, '<br>')}</p>
          <hr>
          <p><em>Sent from ProjectHub contact form</em></p>
        `,
        replyTo: email
      };

      // Send email


export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { name, email, message } = req.body;

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `"Contact Form" <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    replyTo: email,
    subject: "New Contact Message",
    text: `Name: ${name}\nEmail: ${email}\nMessage: ${message}`,
  });

  res.status(200).json({ success: true });
}

