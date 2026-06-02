FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PORT=3030
ENV HOME=/home/scott
ENV INCUS_CONF=/incus-client
ENV CONFIG_PATH=/app/config.json

RUN apt update && apt install -y \
    nodejs \
    npm \
    incus-client \
    openssh-client \
    rsync \
    jq \
    xz-utils \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 scott \
    && useradd -m -u 1001 -g 1001 -s /bin/bash scott

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN chown -R scott:scott /app

USER scott

EXPOSE 3030

CMD ["node", "server.js"]
