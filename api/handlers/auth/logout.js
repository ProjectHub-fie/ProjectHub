import nc from "next-connect";

const handler = nc()
  .post((req, res) => {
    res.setHeader('Set-Cookie', 'connect.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    res.json({ message: "Logged out successfully" });
  });

export default handler;
