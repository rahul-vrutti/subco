# Use official Node.js runtime as base image
FROM node:18-alpine

# Set working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install app dependencies
RUN npm ci --only=production

# Copy app source code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV MQTT_BROKER_URL=mqtt://100.103.254.213:1883

# Create a non-root user to run the application
RUN addgroup -g 1001 -S nodejs
RUN adduser -S subco -u 1001

# Change ownership of the app directory to the nodejs user
RUN chown -R subco:nodejs /usr/src/app
USER subco

# Expose port (if needed for health checks or monitoring)
EXPOSE 3000

# Give Docker a graceful stop window (used by Watchtower)
STOPSIGNAL SIGTERM

# Optional: healthcheck so Watchtower/Docker know it's healthy before/after restart
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Run Node directly
CMD ["node", "subco.js"]