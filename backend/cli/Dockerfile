FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add libgcc libstdc++ ripgrep

FROM base AS build-amd64
COPY dist/axiomics-linux-x64-baseline-musl/bin/axiomics /usr/local/bin/axiomics

FROM base AS build-arm64
COPY dist/axiomics-linux-arm64-musl/bin/axiomics /usr/local/bin/axiomics

ARG TARGETARCH
FROM build-${TARGETARCH}
RUN axiomics --version
ENTRYPOINT ["axiomics"]
