# Architecture Document for Realtime Debate Arena

## 1. Tech Stack

### Frontend
- **Framework:** React Native (v0.71) for cross-platform development (iOS, Android, Web)
- **State Management:** Redux (v4.2.0) for managing application state
- **Real-time Communication:** WebRTC (v1.0.30033) for peer-to-peer audio

### Backend
- **Framework:** Node.js (v18.12.0) with Express (v4.18.2) for API services
- **Real-time Data Processing:** Redis (v7.0) for managing real-time audience voting
- **Database:** PostgreSQL (v15) for storing debate archives and user data
- **AI Integration:** OpenAI Realtime 2 API and OpenAI Agents SDK for AI moderation and orchestration

### Hosting & Deployment
- **Cloud Provider:** AWS (Elastic Beanstalk for application hosting, RDS for PostgreSQL, ElastiCache for Redis)
- **CI/CD:** GitHub Actions for automated testing and deployment

## 2. Project Structure

```
realtime-debate-arena/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── screens/
│   │   ├── redux/
│   │   ├── assets/
│   │   ├── utils/
│   │   └── App.js
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   └── app.js
│   └── package.json
│
├── database/
│   ├── migrations/
│   ├── seeders/
│   └── schema.sql
│
├── scripts/
│   └── deployment/
│
└── README.md
```

## 3. API Design

### Endpoints

#### User Authentication
- **POST /api/auth/register**
  - Request: `{ "username": "string", "email": "string", "password": "string" }`
  - Response: `{ "message": "User registered successfully", "userId": "string" }`

- **POST /api/auth/login**
  - Request: `{ "email": "string", "password": "string" }`
  - Response: `{ "token": "string", "userId": "string" }`

#### Debates
- **GET /api/debates**
  - Request: `N/A`
  - Response: `{ "debates": [ { "id": "string", "topic": "string", "participants": ["string"], "status": "string" } ] }`

- **POST /api/debates**
  - Request: `{ "topic": "string", "participants": ["string"] }`
  - Response: `{ "debateId": "string", "status": "created" }`

- **POST /api/debates/:debateId/vote**
  - Request: `{ "userId": "string", "vote": "string" }`
  - Response: `{ "message": "Vote recorded" }`

#### AI Integration
- **POST /api/ai/moderate**
  - Request: `{ "debateId": "string", "speech": "string" }`
  - Response: `{ "analysis": "string", "facts": [ "string" ] }`

## 4. Data Models

### User Table
- `id`: UUID
- `username`: VARCHAR(255)
- `email`: VARCHAR(255)
- `password_hash`: VARCHAR(255)
- `subscription_status`: ENUM('free', 'premium')

### Debate Table
- `id`: UUID
- `topic`: TEXT
- `created_at`: TIMESTAMP
- `status`: ENUM('scheduled', 'active', 'completed')
- `participants`: JSONB

### Votes Table
- `id`: UUID
- `debate_id`: UUID
- `user_id`: UUID
- `vote`: VARCHAR(255)
- `timestamp`: TIMESTAMP

## 5. Authentication

### Approach
- **JWT (JSON Web Tokens)**
  - On successful login, generate a JWT token that clients will use for subsequent requests.
  - Tokens are verified for each request to secure endpoints.

### Flow
1. User registers and logs in.
2. Server generates a JWT and sends it to the client.
3. Client stores the token and includes it in the `Authorization` header for protected requests.

## 6. State Management

### Frontend State Strategy
- **Redux** is used to manage global state.
- **Middleware:** Redux Thunk for handling asynchronous actions.
- **Slices:** Separate slices for user authentication, debates, and real-time updates.

## 7. Key Dependencies

- **Frontend:**
  - `react-native`: Development framework for mobile apps.
  - `redux`: State management.
  - `webrtc-adapter`: WebRTC support.

- **Backend:**
  - `express`: Web framework for Node.js.
  - `pg`: PostgreSQL client for Node.js.
  - `redis`: Redis client for Node.js.
  - `jsonwebtoken`: JWT implementation.

## 8. Deployment

### Recommended Hosting
- **AWS Elastic Beanstalk:** For hosting both frontend and backend applications.
- **AWS RDS:** Managed PostgreSQL database.
- **AWS ElastiCache:** Managed Redis for real-time operations.

### CI/CD Approach
- **GitHub Actions:**
  - Automated testing on pull requests.
  - Deployment workflow triggered on merges to the main branch.
  - Environment-specific configurations using AWS Secrets Manager for sensitive data management.