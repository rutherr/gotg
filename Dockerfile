# Dockerfile
FROM node:20-bookworm-slim

WORKDIR /app

# better-sqlite3 compiles a native addon at install time -- needs a C++ toolchain.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Regenerate the piece SVGs and compiled Tailwind CSS at build time so the
# image is self-contained even if these ever get git-ignored/removed from
# the repo (see .gitignore).
RUN npm run generate-assets \
  && npm run build:css

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
