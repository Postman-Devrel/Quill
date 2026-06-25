FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install

COPY agent/ ./agent/

CMD ["bun", "run", "agent/index.ts"]
