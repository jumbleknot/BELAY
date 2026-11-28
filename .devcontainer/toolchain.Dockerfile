# .devcontainer/toolchain.Dockerfile — feature 004 (dev container on Docker Sandbox)
#
# The HEAVY, build-once image. It is built by CI (.forgejo/workflows/devcontainer-image.yml →
# `belay-devcontainer` in the forge's container registry), or locally with
# scripts/build-devcontainer-image.mjs, then pulled by digest. The committed thin `Dockerfile` does
# `FROM ${BASE_IMAGE}` against it, so a container recreate is a download, not a rebuild.
#
# ⚠️ NEVER BUILD THIS INSIDE THE SANDBOX. The build needs open egress: rustup fetches from
# sh.rustup.rs and static.rust-lang.org, which the egress allowlist deliberately does not carry.
# Build it in CI, or on a host engine with open egress (research R5). Widening the allowlist to
# make an in-sandbox build work is the wrong fix.
#
# Contents: the toolchain BELAY's checks and workflow need, at the repository's pins (spec FR-005).
# NO credentials and NO personal tools are baked here (FR-017): the personal layer (RTK, plugins)
# comes from the dotfiles repository onto the persistent ~/.claude volume. Layers run slow → fast,
# so a cheap change does not rebuild an expensive layer.
#
# Guarded by scripts/__tests__/toolchain-dockerfile.guard.test.mjs.

FROM node:26-bookworm@sha256:893ea48106e988a5f91e69629d6472600daa9d0494adf7db87eb0b886ce82255

# --- apt base -----------------------------------------------------------------------------------
# build-essential + pkg-config + libssl-dev let the personal layer's `cargo install` of RTK compile
# crates with native build scripts. jq serves scripts and checks; sudo is for in-container admin.
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        git \
        build-essential \
        pkg-config \
        libssl-dev \
        curl \
        ca-certificates \
        unzip \
        sudo \
        jq \
    && rm -rf /var/lib/apt/lists/*

# --- security: a fixed advisory the upstream base has not picked up yet (feature 010) ------------
# The builder scan (scripts/image-scan.mjs --image, in devcontainer-image.yml) refuses to push an image
# with a FIXABLE Critical. When the pinned upstream base carries one and no newer base digest exists,
# the fixed package is upgraded here. DELETE this layer once a re-pin of the FROM line above carries the
# fix (security/images/allowlist.yaml's matching entry then goes UNMATCHED, which is the signal).
#   CVE-2026-99362: linux-libc-dev 6.1.192-2 → 6.1.192-3 (measured 2026-11-28, sweep run 8667; item #97)
#   (CVE-2026-99083, 6.1.190-1 → 6.1.192-1, was discharged by the 2026-11-28 re-pin, which ships 6.1.192-2.)
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends --only-upgrade linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*

# --- Claude Code CLI [root] ---------------------------------------------------------------------
# Symlinks into the root-owned /usr/local prefix, so it must be installed as root here; installing
# from a non-root lifecycle hook fails with EACCES. It is a tool, not a secret.
RUN npm install -g @anthropic-ai/claude-code

# --- gh (GitHub CLI) from its apt repository [root] ---------------------------------------------
RUN export DEBIAN_FRONTEND=noninteractive \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# --- the non-root user `coder`, at uid 1000 -----------------------------------------------------
# node:<major>-bookworm ships uid 1000 as `node`, so a plain `useradd` would put coder on 1001. In
# the sandbox the clone at /workspaces/belay is owned by the VM user at uid 1000, so a 1001
# container user cannot write it, and git fails deep on individual object writes with messages
# that read like repository corruption. ("node" is how uid 1000 renders inside the container; the
# VM calls the same uid `agent`. The name difference is what disguises the problem.)
#
# THE RENUMBER MUST HAPPEN HERE, before the heavy layers. Done later as a layer on top, changing a
# file's ownership copies it up into the new overlay layer, so the "thin" layer duplicates the
# whole image. Move node aside rather than deleting it; nothing here runs as `node`.
ARG USERNAME=coder
ARG USER_UID=1000
ARG USER_GID=1000
RUN if id -u node >/dev/null 2>&1 && [ "$(id -u node)" = "1000" ]; then \
      usermod -u 1100 node && groupmod -g 1100 node; \
    fi
RUN groupadd -g "${USER_GID}" "${USERNAME}" \
    && useradd --create-home --shell /bin/bash -u "${USER_UID}" -g "${USER_GID}" "${USERNAME}" \
    && echo "${USERNAME} ALL=(root) NOPASSWD:ALL" > "/etc/sudoers.d/${USERNAME}" \
    && chmod 0440 "/etc/sudoers.d/${USERNAME}" \
    && mkdir -p /commandhistory \
    && chown "${USERNAME}:${USERNAME}" /commandhistory \
    && mkdir -p "/home/${USERNAME}/.docker-sandbox" \
    && chown "${USERNAME}:${USERNAME}" "/home/${USERNAME}/.docker-sandbox"

# --- cache homes + PATH --------------------------------------------------------------------------
# Only DOWNLOAD caches are volumed (the pnpm store). The baked toolchain (.cargo/bin, .rustup) is
# never volumed, or a stale volume would shadow a refreshed image.
ENV CARGO_HOME=/home/${USERNAME}/.cargo \
    RUSTUP_HOME=/home/${USERNAME}/.rustup \
    UV_CACHE_DIR=/home/${USERNAME}/.cache/uv \
    PATH=/home/${USERNAME}/.cargo/bin:/home/${USERNAME}/.local/bin:${PATH}

USER ${USERNAME}
WORKDIR /home/${USERNAME}

# Pre-create and own the volume mount targets, so a fresh named volume's copy-up carries coder's
# ownership rather than root's.
RUN mkdir -p \
      "/home/${USERNAME}/.local/share/pnpm/store" \
      "/home/${USERNAME}/.claude" \
      "${UV_CACHE_DIR}"

# --- Rust, minimal [coder] -----------------------------------------------------------------------
# Present ONLY because the personal layer builds RTK with `cargo install --git`. No components and
# no cargo utilities: BELAY has no Rust code. Fetched at image-build time, which is why this image
# is never built behind the sandbox's egress policy.
RUN curl -fsSL https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain 1.100.0 \
    && rustc --version && cargo --version

# --- uv + the Specify CLI (Spec Kit) [coder] ----------------------------------------------------
# SPECKIT_VERSION is pinned to the release the project files were generated by
# (.specify/init-options.json `speckit_version`). An unpinned install tracks spec-kit `main`, so a
# rebuild could get a CLI newer than the checked-in scripts and skills. Bump both together, per
# docs/runbooks/spec-kit.md. Only the help PROBE is tolerated below: the `||` is braced, so a failed
# uv or spec-kit install still fails the build.
ARG SPECKIT_VERSION=v1.4.2
RUN curl -LsSf https://astral.sh/uv/0.13.9/install.sh | sh \
    && uv --version \
    && uv tool install --from "git+https://github.com/github/spec-kit.git@${SPECKIT_VERSION}" specify-cli \
    && { specify --help >/dev/null 2>&1 || echo "toolchain.Dockerfile: 'specify' installed (help probe non-zero is tolerated at build time)"; }

# --- PowerShell (pwsh): Spec Kit's scripts are PowerShell only [root] ---------------------------
# Without pwsh the /speckit-* commands cannot run their scripts, and that failure is SILENT: the
# assistant does the bookkeeping by hand instead. The self-contained tarball needs no Microsoft apt
# source. libicu72 is what its bundled runtime needs for globalization; it is installed EXPLICITLY
# rather than inherited, or a future trim of the apt set turns pwsh into a startup crash whose
# message names neither this layer nor the package it lost. At the tail, so a pwsh bump does not
# rebuild the Rust layer.
ARG POWERSHELL_VERSION=7.7.0
USER root
RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update; \
    apt-get install -y --no-install-recommends libicu72; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /opt/microsoft/powershell/7; \
    curl -fsSL -o /tmp/powershell.tar.gz \
      "https://github.com/PowerShell/PowerShell/releases/download/v${POWERSHELL_VERSION}/powershell-${POWERSHELL_VERSION}-linux-x64.tar.gz"; \
    tar -xzf /tmp/powershell.tar.gz -C /opt/microsoft/powershell/7; \
    rm -f /tmp/powershell.tar.gz; \
    chmod +x /opt/microsoft/powershell/7/pwsh; \
    ln -sf /opt/microsoft/powershell/7/pwsh /usr/bin/pwsh; \
    pwsh --version

# --- pnpm at exactly package.json `packageManager` [root] ---------------------------------------
# The one provisioning path every image and CI job uses (scripts/install-pnpm.sh). Node 26 bundles
# no corepack. At the TAIL because it COPYs package.json, and every edit to that file would
# otherwise rebuild the layers above. A pnpm baked before a `packageManager` bump still runs the new
# version: pnpm re-execs itself at the version the nearest manifest names.
COPY package.json scripts/install-pnpm.sh /tmp/pnpm-pin/
RUN sh /tmp/pnpm-pin/install-pnpm.sh /tmp/pnpm-pin/package.json && rm -rf /tmp/pnpm-pin
USER ${USERNAME}

ENV SHELL=/bin/bash
