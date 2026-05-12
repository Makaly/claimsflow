# Quick Start Guide

## Fastest Way to Run the Application

### Using Docker (Recommended - 2 Commands)

```bash
# 1. Start all services
docker-compose up -d

# 2. Run database migrations
docker-compose exec backend npx prisma migrate dev --name init

# Done! Access the app at:
# Frontend: http://localhost:3000
# Backend: http://localhost:4000
```

### Without Docker (Manual Setup)

#### Prerequisites
Install these first:
- Node.js 20+
- PostgreSQL 15
- Redis 7

#### Setup Steps

```bash
# 1. Install backend dependencies
cd backend
npm install

# 2. Set up database
npx prisma migrate dev --name init
npx prisma generate

# 3. Create upload folders
mkdir -p uploads/claims uploads/documents

# 4. Start backend (in one terminal)
npm run start:dev

# 5. Install frontend dependencies (in another terminal)
cd ../frontend
npm install

# 6. Start frontend
npm run dev
```

## First Time Login

The system doesn't have any default users. You need to register first:

1. Go to http://localhost:3000
2. You'll see the login page
3. Click "Register" or use the API:

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@cic.com",
    "password": "admin123",
    "name": "Admin User"
  }'
```

4. Login with your credentials

## Test the System

### 1. Create a Provider

```bash
curl -X POST http://localhost:4000/api/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "Nairobi Hospital",
    "type": "hospital",
    "contactPerson": "Dr. John Doe",
    "email": "contact@nairobihospital.com",
    "phone": "+254712345678",
    "address": "Argwings Kodhek Road, Nairobi"
  }'
```

### 2. Create a Claim

Use the frontend UI or API:
- Navigate to Claims page
- Click "Upload Claim"
- Fill in the claim details
- Upload supporting documents

### 3. Check Dashboard

Visit the Dashboard to see:
- Total claims
- Pending, approved, and rejected counts
- Recent activity

## Common Issues

### "Port 3000/4000 already in use"
```bash
# Kill processes on those ports
lsof -ti:3000 | xargs kill -9
lsof -ti:4000 | xargs kill -9
```

### "Database connection failed"
Make sure PostgreSQL is running:
```bash
# Check status
sudo systemctl status postgresql

# Start if needed
sudo systemctl start postgresql
```

### "Redis connection failed"
Make sure Redis is running:
```bash
# Check status
sudo systemctl status redis

# Start if needed
sudo systemctl start redis
```

## Next Steps

- Read the full [README.md](./README.md) for detailed documentation
- Check the API endpoints in the README
- Explore the codebase structure
- Customize the UI theme in `frontend/src/main.tsx`

## Development Tips

### Hot Reload
Both frontend and backend support hot reload during development.

### Database Exploration
```bash
cd backend
npx prisma studio
# Opens a web UI at http://localhost:5555
```

### View Logs
```bash
# Docker logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Or tail log files directly when running manually
```

That's it! You're ready to develop and use the CIC Claims Automation System.
