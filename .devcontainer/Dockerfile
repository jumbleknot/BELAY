# .devcontainer/Dockerfile — feature 004
#
# The THIN substitution seam. Its only job is to let devcontainer.json parametrize the base image
# through `build.args`, because the dev-container spec's top-level `image` property is not
# substitution-eligible, while `build.args` is.
#
# BASE_IMAGE = ${localEnv:BELAY_DEVCONTAINER_IMAGE:belay-devcontainer}: the digest-pinned toolchain
# image published by .forgejo/workflows/devcontainer-image.yml. The default `belay-devcontainer`
# resolves to a locally built image (scripts/build-devcontainer-image.mjs, on an engine with open
# egress). It is colon-free because the ${localEnv} parser truncates a default at its first colon.
# The registry host never enters git; it lives only in the VM's env file.
#
# Keep this file minimal. All setup is in toolchain.Dockerfile. In particular, never add a uid
# renumber here: on an overlay filesystem, changing a file's ownership copies it up into the new
# layer, so a "thin" renumber layer duplicates the whole image. The user is created at uid 1000 in
# toolchain.Dockerfile instead.
ARG BASE_IMAGE=belay-devcontainer
FROM ${BASE_IMAGE}
