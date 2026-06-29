FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Copy package manifest, lockfile, and .npmrc first for layer caching.
# .npmrc sets confirm-module-purge=false to suppress pnpm's TTY prompt in CI.
COPY package.json pnpm-lock.yaml .npmrc ./

# Enable corepack (provides pnpm without a separate install step).
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies. --frozen-lockfile ensures reproducibility in CI.
RUN pnpm install --frozen-lockfile

# Copy the rest of the source tree.
COPY . .

# The Playwright image includes Chromium and its dependencies.
# Extension tests use --headless=new which is supported in Chrome 112+.
# The tests start the Vite dev server internally via playwright webServer.
#
# J1 fixture server uses devtest.internal as a non-blocked hostname for the
# fixture page server. Docker run passes --add-host devtest.internal:127.0.0.1
# to wire the hostname (see test:extension:e2e:docker in package.json).
# Extension service workers do not register in Chrome's headless modes.
# We start Xvfb on :99 so Chrome can run headed (required for MV3 extensions).
ENV DISPLAY=:99
CMD ["sh", "-c", "Xvfb :99 -screen 0 1280x1024x24 & sleep 2 && pnpm run test:extension:e2e --reporter=list"]
