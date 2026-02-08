export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ message: "Method not allowed" });
    }

    // Parse body
    let body = {};
    if (req.headers['content-type']?.includes('application/json')) {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString());
    }

    const { name, email, message, captchaToken } = body;

    if (!name || !email || !message) {
      return res.status(400).json({ message: "Name, email, and message are required" });
    }

    // Captcha verification (if enabled)
    if (captchaToken && process.env.NODE_ENV === 'production') {
      const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
      if (turnstileSecret) {
        try {
          const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${turnstileSecret}&response=${captchaToken}`
          });
          const verifyData = await verifyResponse.json();
          if (!verifyData.success) {
            return res.status(400).json({ message: "Security verification failed" });
          }
        } catch (error) {
          console.error('Captcha verification error:', error);
          return res.status(500).json({ message: "Security verification failed" });
        }
      }
    }

    // In a real app, you'd send an email here
    console.log('Contact form submission:', { name, email, message });
    
    return res.json({ message: "Message sent successfully" });
  } catch (error) {
    console.error('Contact handler error:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
}