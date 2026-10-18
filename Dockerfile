# ARGraphics: API + dashboard + guest page in one container. See OPERATIONS.md.
FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Install with the full lockfile first so the layer caches across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.json ./
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/argraphics/package.json artifacts/argraphics/
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/db/package.json lib/db/
COPY scripts/package.json scripts/
RUN pnpm install --frozen-lockfile

COPY . .

# Web build. VITE_PUBLIC_APP_URL may be passed as a build arg; with the API serving the
# web app on one origin it can stay empty and the browser's own origin is used.
ARG VITE_PUBLIC_APP_URL=
ARG VITE_APP_STORE_URL=
ENV VITE_PUBLIC_APP_URL=$VITE_PUBLIC_APP_URL
ENV VITE_APP_STORE_URL=$VITE_APP_STORE_URL
RUN pnpm run typecheck:libs \
 && cd artifacts/argraphics && PORT=3000 BASE_PATH=/ NODE_ENV=production pnpm run build \
 && cd ../api-server && pnpm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Apply pending migrations, then start. A healthy database with nothing pending is a no-op.
CMD ["sh", "./scripts/start-production.sh"]
