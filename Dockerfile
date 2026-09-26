# ProjectHub runtime image.
#
# One image carries the whole repository — `api/`, `bot/`, `server/`, `client/`
# and `tests/` — because the three processes that make up a deployment all need
# different parts of it and the admin test-runner console needs the suite that
# Vercel strips out of the serverless build:
#
#   * the dashboard + API  → `node server/index.ts` (Vite middleware in dev)
#   * the Discord bot      → `node bot/index.js`
#   * the test suite       → `node --test tests/`
#
# `tests/` and `.git/` are intentionally kept in the image: the runner executes
# the former, and `tests/db-config.test.mjs` shells out to `git ls-files`, so git
# has to be installed rather than assumed.
FROM node:24-bookworm-slim

WORKDIR /app

# git for the db-config test's `git ls-files`; ca-certificates for TLS to a
# managed database (Neon) from inside the container.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Dependency layer first so a source edit does not reinstall the tree. The
# lockfile is copied whole, and `dataconnect-generated` is a `file:` dependency
# that has to exist before `npm ci` resolves it.
COPY package.json package-lock.json ./
COPY dataconnect-generated ./dataconnect-generated
RUN npm ci --no-audit --no-fund

# Then the source. `.dockerignore` keeps node_modules and build output out of the
# context, so this copies source and tests, not a stale dependency tree.
COPY . .

# Build the client so a production-style start can serve static assets. The
# default command still runs in development mode, which is what a long-lived host
# in this repository has always used.
RUN npm run build

ENV NODE_ENV=development
EXPOSE 5000

# The app by default. Compose overrides this for the bot and test services.
CMD ["npx", "tsx", "server/index.ts"]
