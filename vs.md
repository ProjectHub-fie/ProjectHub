# Running Locally in VS Code

To run this project on VS Code after cloning it from GitHub, follow these setup steps:

### 1. Install Dependencies
Open your terminal in VS Code and run:
```bash
npm install
```

### 2. Set Up Environment Variables
Create a `.env` file in the root directory and add your configuration:
```env
DATABASE_URL=your_postgres_url_here
VITE_TURNSTILE_SITE_KEY=your_site_key
TURNSTILE_SECRET_KEY=your_secret_key
SESSION_SECRET=your_random_string_here
# Optional: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, etc.
```

### 3. Database Setup
Push the schema to your local or remote database:
```bash
npm run db:push
```

### 4. Run the Application
Start the development server:
```bash
npm run dev
```

### Prerequisites
- **Node.js**: Version 18 or higher.
- **PostgreSQL**: A running instance accessible via the `DATABASE_URL`.
- **Environment**: The project uses `tsx` and `vite`, which are included in the dependencies.
