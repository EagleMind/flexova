# The flexova CLI with Pandoc, so any language or CI system can convert and check documents:
#   docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" ghcr.io/eaglemind/flexova-cli build manual.docx --lang en
FROM node:22-trixie-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter "@flexova/cli..." run build \
 && pnpm --filter @flexova/cli deploy --prod --legacy /out

FROM node:22-trixie-slim
LABEL org.opencontainers.image.source="https://github.com/EagleMind/flexova" \
      org.opencontainers.image.description="The flexova CLI with Pandoc" \
      org.opencontainers.image.licenses="Apache-2.0"
RUN apt-get update \
 && apt-get install -y --no-install-recommends pandoc \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /out /opt/flexova
RUN ln -s /opt/flexova/dist/cli.js /usr/local/bin/flexova
USER node
WORKDIR /work
ENTRYPOINT ["flexova"]
CMD ["--help"]
