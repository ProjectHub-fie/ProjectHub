# Portfolio Web Application

## Environment Variables and Secrets

To run this project, you need to set up the following environment variables and secrets in your Replit environment.

### Required Secrets

These are sensitive credentials that should be added through the **Secrets** tab (the padlock icon) in the Replit sidebar.

| Secret Name | Description |
| :--- | :--- |
| `DATABASE_URL` | Your PostgreSQL connection string (e.g., `postgresql://user:password@host:port/dbname`). |
| `SESSION_SECRET` | A long, random string used to sign session cookies for authentication. |

### System Environment Variables

These are usually provided automatically by the Replit environment, but ensure they are present if you are moving the project elsewhere.

| Variable Name | Description |
| :--- | :--- |
| `NODE_ENV` | Set to `development` for local testing or `production` for live deployment. |
| `PORT` | The port the server listens on (defaults to `5000` in our setup). |

## How to Add Them in Replit

1.  **Open the Secrets Tool:** Click on the "Secrets" icon (padlock) in the left-hand sidebar of your Replit workspace.
2.  **Add DATABASE_URL:**
    *   **Key:** `DATABASE_URL`
    *   **Value:** Paste your PostgreSQL connection string.
3.  **Add SESSION_SECRET:**
    *   **Key:** `SESSION_SECRET`
    *   **Value:** Enter a secure random string (e.g., `3f8a9c2b7d...`).
4.  **Click "Add new secret"** for each one.
5.  **Restart the Application:** Once added, Replit will automatically make these available to your app. You may need to click the "Run" button again to ensure the new values are loaded.

---

## Local Development Setup

If you are running this locally, you can create a `.env` file in the root directory:

```env
DATABASE_URL=your_postgres_url_here
SESSION_SECRET=your_random_secret_here
NODE_ENV=development
PORT=5000
```
