# OrderzHouse Backend

The backend API server for OrderzHouse, a comprehensive freelance platform built with Node.js, Express, and PostgreSQL.

## Overview

This Express.js application provides RESTful APIs and real-time communication for the OrderzHouse platform. It handles user authentication, project management, messaging, course management, and administrative functions.

## Technology Stack

- **Node.js**: JavaScript runtime with ES modules
- **Express.js**: Web framework for API routes
- **PostgreSQL**: Relational database
- **Socket.io**: Real-time bidirectional communication
- **JWT**: JSON Web Tokens for authentication
- **AdminJS**: Admin panel for system management
- **Multer**: File upload handling
- **Bcrypt**: Password hashing
- **Cloudinary**: Cloud storage for images

## Features

### API Endpoints
- **Users** (`/users`): User registration, authentication, profile management
- **Projects** (`/projects`): Project creation, bidding, management
- **Orders** (`/orders`): Order processing and management
- **Courses** (`/courses`): Course management and enrollment
- **Feedback** (`/feedbacks`): User feedback and reviews
- **Appointments** (`/appointments`): Scheduling system
- **Logs** (`/logs`): System logging
- **News** (`/news`): News and announcements
- **Upload** (`/upload`): File upload handling
- **Chats** (`/chats`): Messaging system

### Real-time Features
- Live chat between users
- Real-time notifications
- Project status updates

### Security
- JWT-based authentication
- Password hashing with bcrypt
- Rate limiting
- CORS configuration
- Input validation

### Admin Panel
- User management
- Project oversight
- Analytics and reporting
- System configuration

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- PostgreSQL database
- npm or yarn

### Installation

1. Navigate to the backend directory:
   ```bash
   cd backendEsModule
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables (see Environment Variables section)

4. Set up the database:
   - Create a PostgreSQL database
   - Run the schema from `models/database_schema.sql`

5. Start the development server:
   ```bash
   npm run dev
   ```

The server will start on `https://orderzhouse-backend.onrender.com` (or the port specified in your `.env` file).

### Available Scripts

- `npm run dev`: Start development server with nodemon (auto-restart on changes)
- `npm start`: Start production server
- `npm test`: Run tests with Jest

## Project Structure

```
backendEsModule/
├── Admin.js                 # AdminJS configuration
├── index.js                 # Main application entry point
├── Admin/
│   ├── adminUi.js          # Admin UI setup
│   ├── handlers/           # Admin handlers
│   ├── resources/          # Admin resources
│   └── utils.js            # Admin utilities
├── controller/             # Route controllers
│   ├── user.js
│   ├── projects.js
│   ├── orders.js
│   └── ...
├── router/                 # Route definitions
│   ├── user.js
│   ├── projects.js
│   ├── orders.js
│   └── ...
├── middleware/             # Custom middleware
│   ├── authentication.js
│   ├── authorization.js
│   └── ...
├── models/                 # Database models and schema
│   ├── db.js               # Database connection
│   └── database_schema.sql # Database schema
├── sockets/                # Socket.io configuration
│   └── socket.js
├── uploads/                # File upload directory
├── tests/                  # Test files
└── package.json
```

## Environment Variables

Create a `.env` file in the backend root with the following variables:

```env
PORT=5000
NODE_ENV=development
DATABASE_URL=postgresql://username:password@localhost:5432/orderzhouse
JWT_SECRET=your-super-secret-jwt-key
REFRESH_TOKEN_SECRET=your-refresh-token-secret
REFRESH_TOKEN_EXPIRES_DAYS=30
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
CLOUDINARY_CLOUD_NAME=your-cloudinary-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret

# Password reset & email (optional; if not set, reset link is logged in dev)
FRONTEND_URL=http://localhost:5173
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
EMAIL_USER=your-smtp-user
EMAIL_PASS=your-smtp-password
EMAIL_FROM=noreply@orderzhouse.com
```

## Database Schema

The application uses PostgreSQL with the following main tables:

- **Users**: User accounts with roles and profiles
- **Projects**: Project listings with bids and assignments
- **Orders**: Client orders and freelancer assignments
- **Courses**: Course catalog and enrollments
- **Feedbacks**: User reviews and ratings
- **Chats**: Messaging system
- **Logs**: System activity logs
- **Plans**: Subscription plans
- **Subscriptions**: User subscriptions

See `models/database_schema.sql` for the complete schema.

## API Documentation

### Authentication
All protected routes require a JWT token in the Authorization header:
```
Authorization: Bearer <jwt-token>
```

### Common Response Format
```json
{
  "success": true,
  "data": {},
  "message": "Operation successful"
}
```

### Error Response Format
```json
{
  "success": false,
  "error": "Error message",
  "code": 400
}
```

## Socket.io Events

The application uses Socket.io for real-time features:

- `connection`: User connects
- `join-room`: Join a chat room
- `send-message`: Send a message
- `receive-message`: Receive a message
- `disconnect`: User disconnects

## Testing

Run tests with:
```bash
npm test
```

Tests are located in the `tests/` directory and use Jest as the testing framework.

## Contributing

1. Follow the existing code structure
2. Write tests for new features
3. Update documentation
4. Use meaningful commit messages

## Deployment

For production deployment:

1. Set `NODE_ENV=production` in environment variables
2. Use a process manager like PM2
3. Configure a reverse proxy (nginx)
4. Set up SSL certificates
5. Configure database connection pooling

## License

This project is licensed under the ISC License.
