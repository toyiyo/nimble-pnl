# Nimble PnL

A modern web application for managing restaurant profit and loss calculations with Square integration.

## Project Overview

Nimble PnL is a comprehensive solution that helps restaurants track and analyze their profit and loss data. It integrates with Square for real-time data synchronization and provides AI-powered insights for better business decisions.

## Architecture

### Frontend
- **Framework**: React 18+ with Vite
- **Language**: TypeScript
- **UI Components**: shadcn/ui + Tailwind CSS
- **State Management**: React Hooks
- **Routing**: React Router

### Backend
- **Platform**: Supabase
- **Functions**: Edge Functions (Deno runtime)
- **Database**: PostgreSQL (via Supabase)
- **Authentication**: Supabase Auth with SSO capabilities
- **File Storage**: Supabase Storage

### Integrations
- Square API for business data
- OpenAI for AI-powered features
- Resend for email services
- SCIM for enterprise user management

## Project Structure

```
src/
├── components/     # React components
├── hooks/         # Custom React hooks
├── integrations/  # Third-party service integrations
├── lib/          # Utility functions
├── pages/        # Route components
└── services/     # Business logic services

supabase/
├── functions/    # Edge Functions
└── migrations/   # Database migrations
```

## Prerequisites

- Node.js 18+ or Bun
- Supabase account
- Square developer account
- OpenAI API key (for AI features)
- Resend API key (for emails)

## Environment Variables

### Required Variables
```bash
# Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_PUBLISHABLE_KEY=your_anon_key

# Square Integration
SQUARE_APPLICATION_ID=your_square_app_id
SQUARE_APPLICATION_SECRET=your_square_app_secret
SQUARE_WEBHOOK_SIGNATURE_KEY=your_webhook_key
ENCRYPTION_KEY=your_encryption_key

# Development Only (Optional)
SQUARE_SANDBOX_APPLICATION_ID=your_sandbox_app_id
SQUARE_SANDBOX_APPLICATION_SECRET=your_sandbox_secret
SQUARE_PERSONAL_ACCESS_TOKEN=your_personal_token

# Additional Services
RESEND_API_KEY=your_resend_key
OPENAI_API_KEY=your_openai_key
```

## Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/toyiyo/nimble-pnl.git
   cd nimble-pnl
   ```

2. Install dependencies:
   ```bash
   bun install
   # or
   npm install
   ```

3. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Fill in the required environment variables

4. Start the development server:
   ```bash
   bun run dev
   # or
   npm run dev
   ```

## Deployment (Coolify)

### Prerequisites
- Coolify account
- Git repository connected to Coolify
- All environment variables ready

### Configuration

1. **Build Settings**
   - Build Pack: Static
   - Base Directory: `/`
   - Pre Deployment Command: `bun install && bun run build`
   - Output Directory: `dist` (automatic)

2. **Environment Variables**
   - Add all required environment variables in Coolify's UI

3. **NGINX Configuration**
   Add the following custom NGINX configuration:
   ```nginx
   server {
       location / {
           root /usr/share/nginx/html;
           index index.html;
           try_files $uri $uri/ /index.html;
       }

       # Handle 404 errors
       error_page 404 /index.html;
       location = /404.html {
           root /usr/share/nginx/html;
           internal;
       }

       # Handle server errors (50x)
       error_page 500 502 503 504 /50x.html;
       location = /50x.html {
           root /usr/share/nginx/html;
           internal;
       }

       # Enable gzip compression
       gzip on;
       gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
   }
   ```

### Deployment Steps

1. Connect your repository in Coolify
2. Configure the deployment settings as above
3. Set up environment variables
4. Deploy the application

## Features

- Square integration for real-time business data
- Automated P&L calculations
- Enterprise SSO support
- SCIM provisioning for user management
- AI-powered product insights
- Team collaboration tools
- Multi-restaurant support

## Testing

### SQL Function Tests

The project includes comprehensive tests for all PostgreSQL database functions using pgTAP.

**Running tests locally:**
```bash
# Navigate to tests directory
cd supabase/tests

# Run all tests
./run_tests.sh
```

**Test coverage:**
- Sales and aggregation functions
- P&L calculation functions
- Inventory management functions
- Search and lookup functions
- Trigger functions
- Security and authentication functions
- Utility and maintenance functions

See [supabase/tests/README.md](supabase/tests/README.md) for detailed testing documentation.

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute to this project.

## License

This project is licensed under the terms of the [LICENSE](LICENSE) file included in the repository.
