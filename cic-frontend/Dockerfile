FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Drop root: run the dev server as the built-in unprivileged `node` user.
RUN chown -R node:node /app
USER node

# Expose port
EXPOSE 3000

# Start development server
CMD ["npm", "run", "dev", "--", "--host"]
