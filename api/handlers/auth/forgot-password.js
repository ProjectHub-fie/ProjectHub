
import nc from "next-connect";

const handler = nc()
  .use((req, res, next) => {
    // Configure CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  })
  .options((req, res) => {
    res.status(200).end();
  })
  .post(async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Verify captcha if provided
      if (req.body.captchaToken && process.env.NODE_ENV === 'production') {
        const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
        try {
          const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${turnstileSecret}&response=${req.body.captchaToken}`
          });
          const verifyData = await verifyResponse.json();
          if (!verifyData.success) {
            console.error('Turnstile verification failed:', verifyData);
            return res.status(400).json({ message: "Security verification failed" });
          }
        } catch (verifyError) {
          console.error('Turnstile fetch error:', verifyError);
          return res.status(500).json({ message: "Verification service unavailable" });
        }
      } else if (req.body.captchaToken) {
        console.log('Skipping Turnstile verification in development');
      }

      // TODO: Implement forgot password logic here
      res.json({ message: "Password reset email sent" });
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ message: "Failed to send reset email" });
    }
  });

export default handler;