# CIC Medical Claims - Quick Start Guide

## 🚀 Getting Started

This guide will help you run the CIC Medical Claims Automation System locally.

---

## ⚠️ Prerequisites

### Required Software
- Node.js 20 LTS (https://nodejs.org/)
- PostgreSQL 14+ (https://www.postgresql.org/)
- Redis (https://redis.io/)
- Git

### For Linux/Ubuntu:
```bash
# Install build tools (required for native modules like bcrypt)
sudo apt-get update
sudo apt-get install -y build-essential python3 make g++

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib

# Install Redis
sudo apt-get install -y redis-server
```

---

## 📦 Installation

### Option 1: Manual Setup (Recommended for Development)

#### 1. Setup Database

```bash
# Start PostgreSQL
sudo service postgresql start

# Create database
sudo -u postgres psql
CREATE DATABASE cic_claims;
CREATE USER cic_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE cic_claims TO cic_user;
\q
```

#### 2. Backend Setup

```bash
# Navigate to backend
cd /home/bigdev/Desktop/cic/claims/backend

# Install dependencies
# If bcrypt fails, try using Docker instead (see Option 2 below)
npm install

# If you get bcrypt errors, install build tools:
sudo apt-get install build-essential python3

# Create .env file
cat > .env << 'EOF'
DATABASE_URL=postgresql://cic_user:your_password@localhost:5432/cic_claims
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d
REDIS_HOST=localhost
REDIS_PORT=6379

# Email Configuration (Update with actual SMTP server)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="CIC Claims <noreply@cic.co.ke>"

# SMS Configuration (Choose one provider)
SMS_PROVIDER=africastalking

# Africa's Talking (Recommended for Kenya)
AFRICASTALKING_API_KEY=your-api-key
AFRICASTALKING_USERNAME=sandbox
AFRICASTALKING_SHORTCODE=

# OR Twilio
# TWILIO_ACCOUNT_SID=your-account-sid
# TWILIO_AUTH_TOKEN=your-auth-token
# TWILIO_PHONE_NUMBER=+1234567890

# EDMS Integration (Update when API specs are available)
EDMS_BASE_URL=https://edms.cic.co.ke/api
EDMS_API_KEY=your-edms-api-key

# eOxegen Integration (Update when API specs are available)
EOXEGEN_BASE_URL=https://eoxegen.cic.co.ke/api
EOXEGEN_API_KEY=your-eoxegen-api-key
EOF

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# Start Redis
sudo service redis-server start
# OR
redis-server --daemonize yes

# Start backend server
npm run start:dev
```

Backend will run on: **http://localhost:3000**

#### 3. Frontend Setup

```bash
# Open new terminal
cd /home/bigdev/Desktop/cic/claims/frontend

# Install dependencies
npm install

# Create .env file
cat > .env << 'EOF'
VITE_API_BASE_URL=http://localhost:3000/api
VITE_APP_NAME=CIC Claims Automation
EOF

# Start frontend development server
npm run dev
```

Frontend will run on: **http://localhost:5173**

#### 4. Access the Application

1. Open browser: http://localhost:5173
2. Default login credentials (create in database or via API):
   - Email: admin@cic.co.ke
   - Password: Admin@123

---

### Option 2: Docker Setup (Recommended for Quick Start)

If you encounter build issues with native modules (like bcrypt), use Docker:

#### 1. Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt-get install docker-compose-plugin
```

#### 2. Create Docker Compose File

```bash
cd /home/bigdev/Desktop/cic/claims

# Docker Compose is already created in docker-compose.yml
```

#### 3. Run with Docker

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

Services:
- Frontend: http://localhost:5173
- Backend: http://localhost:3000
- Database: localhost:5432
- Redis: localhost:6379

---

## 🔧 Troubleshooting

### bcrypt Installation Fails

**Error**: `npm error command failed` when installing bcrypt

**Solution 1** - Install build tools:
```bash
sudo apt-get install build-essential python3 make g++
npm install
```

**Solution 2** - Use Docker:
```bash
docker-compose up -d
```

**Solution 3** - Use bcryptjs (alternative):
```bash
# In backend/package.json, replace bcrypt with bcryptjs
npm uninstall bcrypt
npm install bcryptjs
# Update imports in code from 'bcrypt' to 'bcryptjs'
```

### PostgreSQL Connection Error

**Error**: `ECONNREFUSED` or `Connection refused`

**Solution**:
```bash
# Start PostgreSQL
sudo service postgresql start

# Check if running
sudo service postgresql status

# Verify connection string in backend/.env
DATABASE_URL=postgresql://cic_user:your_password@localhost:5432/cic_claims
```

### Redis Connection Error

**Error**: `ECONNREFUSED` when connecting to Redis

**Solution**:
```bash
# Start Redis
sudo service redis-server start

# OR run in foreground
redis-server

# Check if running
redis-cli ping
# Should return: PONG
```

### Frontend Can't Connect to Backend

**Error**: Network error or CORS issues

**Solution**:
1. Ensure backend is running: http://localhost:3000
2. Check `.env` in frontend:
   ```
   VITE_API_BASE_URL=http://localhost:3000/api
   ```
3. Backend CORS is configured to allow localhost

### Port Already in Use

**Error**: `Port 3000 already in use`

**Solution**:
```bash
# Find process using port
sudo lsof -i :3000

# Kill process
sudo kill -9 <PID>

# OR use different port in backend/src/main.ts
```

---

## 📝 Default Test Data

### Create Admin User

```bash
# Using Prisma Studio (GUI)
cd backend
npx prisma studio

# OR using psql
psql -U cic_user -d cic_claims

INSERT INTO "User" (id, email, password, name, role, "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'admin@cic.co.ke',
  '$2b$10$YourHashedPasswordHere',  -- Hash the password first
  'System Administrator',
  'admin',
  true,
  NOW(),
  NOW()
);
```

### Create Test Provider

```sql
INSERT INTO "Provider" (id, code, name, type, email, "phoneNumber", address, city, region, "postalCode", "licenseNumber", "approvalStatus", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'PROV001',
  'Test Hospital',
  'hospital',
  'hospital@test.com',
  '+254712345678',
  '123 Test Street',
  'Nairobi',
  'Nairobi',
  '00100',
  'LIC123456',
  'approved',
  true,
  NOW(),
  NOW()
);
```

---

## 🧪 Testing the Application

### 1. Test Batch Upload

1. Login to the system
2. Navigate to **Batch Upload** (`/batch-upload`)
3. Drag and drop PDF files (max 100)
4. Click **Upload Batch**
5. Check that batch number is generated

### 2. Test Workflow

1. Navigate to **Workflow Dashboard** (`/workflow`)
2. View statistics
3. Go to **Maker Queue** (`/workflow/maker`)
4. Approve/Reject a claim
5. Go to **Checker Queue** (`/workflow/checker`)
6. Final approve a claim

### 3. Test 2FA

1. Navigate to **Profile** (`/profile`)
2. Click **Two-Factor Authentication**
3. Setup using Google Authenticator
4. Save backup codes

### 4. Test Provider Approval

1. Register a new provider
2. Navigate to **Provider Approvals** (`/provider-approvals`)
3. Approve or reject the provider

---

## 📊 Monitoring

### Backend Logs
```bash
# View backend logs
cd backend
npm run start:dev

# Logs show:
# - HTTP requests
# - Database queries
# - Job queue processing
# - Errors and warnings
```

### Database
```bash
# Open Prisma Studio (GUI)
cd backend
npx prisma studio

# Opens at http://localhost:5555
```

### Redis Queue
```bash
# Monitor Redis
redis-cli monitor

# Check job queues
redis-cli
> KEYS bull:*
```

---

## 🔐 Security Notes

### For Development
- JWT_SECRET: Use any random string
- Database password: Can be simple
- SMTP: Can use Gmail with app password

### For Production
- Generate strong JWT_SECRET: `openssl rand -base64 32`
- Use strong database passwords
- Use dedicated SMTP service (SendGrid, AWS SES)
- Enable HTTPS
- Set up firewall rules
- Use environment-specific .env files

---

## 📚 Useful Commands

### Backend Commands
```bash
# Development
npm run start:dev

# Production build
npm run build
npm run start:prod

# Database
npx prisma migrate dev    # Run migrations
npx prisma studio         # Open database GUI
npx prisma generate       # Generate Prisma client

# Testing
npm run test              # Unit tests
npm run test:e2e          # E2E tests
npm run test:cov          # Coverage
```

### Frontend Commands
```bash
# Development
npm run dev

# Production build
npm run build
npm run preview           # Preview production build

# Linting
npm run lint
```

### Docker Commands
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Restart a service
docker-compose restart backend

# Stop all services
docker-compose down

# Rebuild after code changes
docker-compose up -d --build
```

---

## 🎯 Next Steps After Setup

1. **Test all features**
   - Login/Logout
   - Batch upload
   - Workflow (Maker/Checker)
   - Provider approvals
   - User management
   - 2FA setup
   - Reports generation

2. **Configure integrations**
   - Update EDMS API credentials when available
   - Update eOxegen API credentials when available
   - Configure SMS provider (Africa's Talking or Twilio)

3. **Deploy to staging**
   - Setup staging environment
   - Configure production database
   - Setup CI/CD pipeline
   - Configure monitoring

4. **User acceptance testing**
   - Create test scenarios
   - Invite CIC users for UAT
   - Collect feedback
   - Fix issues

---

## 📞 Support

If you encounter issues:

1. Check this guide for troubleshooting steps
2. Review error logs in terminal
3. Check `IMPLEMENTATION_COMPLETE.md` for detailed backend info
4. Check `FRONTEND_COMPLETE.md` for frontend details
5. Review `COMPLETE_IMPLEMENTATION_SUMMARY.md` for overall architecture

---

## ✅ Success Criteria

You've successfully set up the system when:

- ✅ Backend server running on http://localhost:3000
- ✅ Frontend running on http://localhost:5173
- ✅ Can login to the system
- ✅ Can navigate between pages
- ✅ Database migrations completed
- ✅ Redis connected (for job queues)
- ✅ No errors in console

---

**🎉 You're now ready to use the CIC Medical Claims Automation System!**

---

*Last Updated: December 30, 2025*
*Version: 1.0.0*
