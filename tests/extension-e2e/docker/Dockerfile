FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Copy package manifest and lockfile first for layer caching.
COPY package.json pnpm-lock.yaml ./

# Enable corepack (provides pnpm without a separate install step).
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies. --frozen-lockfile ensures reproducibility in CI.
RUN pnpm install --frozen-lockfile

# Copy the rest of the source tree.
COPY . .

# The Playwright image includes Chromium and its dependencies.
# Extension tests use --headless=new which is supported in Chrome 112+.
# The tests start the Vite dev server internally via playwright webServer.
CMD ["pnpm", "run", "test:extension:e2e", "--reporter=list"]
