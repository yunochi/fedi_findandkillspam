ARG NODE_VERSION=20.12.2-bullseye

# build assets & compile TypeScript
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION} AS native-builder
WORKDIR /workspace
COPY --link ["package-lock.json", "tsconfig.json", "package.json", "config_example.json", "./"]
COPY --link ["src", "./src"]
RUN ln -s config_example.json config.json
RUN npm install
RUN npm run build


# build native dependencies for target platform
FROM --platform=$TARGETPLATFORM node:${NODE_VERSION} AS target-builder
WORKDIR /workspace
COPY --link ["package-lock.json", "tsconfig.json", "package.json", "./"]
COPY --link ["src", "./src"]
RUN npm install



FROM --platform=$TARGETPLATFORM node:${NODE_VERSION}-slim AS runner
ARG UID="991"
ARG GID="991"

RUN  apt-get update \
	&& apt-get install -y --no-install-recommends \
	tini \
	&& groupadd -g "${GID}" node-user \
	&& useradd -l -u "${UID}" -g "${GID}" -m -d /workspace node-user \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists

USER node-user
WORKDIR /workspace

COPY --chown=node-user:node-user --from=target-builder /workspace/node_modules ./node_modules
COPY --chown=node-user:node-user --from=native-builder /workspace/dist ./dist
COPY --chown=node-user:node-user package.json ./



ENV NODE_ENV=production

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start"]
