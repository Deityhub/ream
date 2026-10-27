# syntax=docker/dockerfile:1
# Ream as a self-hosted web app: the site is built with Node, then served by NGINX (as a non-root user, on port 8080)
# with the same security headers as ream.deityhub.com. Nothing in it talks to a server about your files: the tools run
# in the browser.
#   docker build -t ream .
#   docker run --rm -p 8080:8080 ream        then open http://localhost:8080

# the build runs on the machine's own platform; only the files it makes go into each platform's image
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY . .
# tests and their fixtures stay out of the image (.dockerignore), so the build skips the typecheck that covers them
RUN yarn install --immutable \
 && yarn workspace @ream/web exec vite build \
 && node scripts/nginx-conf.ts > /src/default.conf

FROM nginxinc/nginx-unprivileged:1.29-alpine
ARG VERSION=dev
LABEL org.opencontainers.image.title="Ream" \
      org.opencontainers.image.description="PDF and image tools that run on your computer. Your files never reach a server." \
      org.opencontainers.image.source="https://github.com/Deityhub/ream" \
      org.opencontainers.image.url="https://ream.deityhub.com" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
COPY --from=build /src/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
