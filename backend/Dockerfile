FROM node:20-alpine

WORKDIR /app

# Install dependencies for node-gyp and Tesseract
RUN apk add --no-cache python3 make g++ tesseract-ocr

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Expose port
EXPOSE 4000

# Start application
CMD ["npm", "run", "start:dev"]
