# Container image for the WNBA Bet Predictor web app.
# Works on any container host (Railway, Fly.io, Cloud Run, Docker, etc.).
FROM node:20-alpine

WORKDIR /app

# Install production dependencies first for better layer caching.
# npm ci is deterministic and respects the committed lockfile.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the rest of the application.
COPY . .

# Persistent state lives here — mount a volume at /data in production
# so journal / bankroll / prediction history survive restarts.
ENV DATA_DIR=/data
ENV PORT=3847
RUN mkdir -p /data

EXPOSE 3847

# Lightweight container healthcheck against the API.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3847)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["npm", "start"]
